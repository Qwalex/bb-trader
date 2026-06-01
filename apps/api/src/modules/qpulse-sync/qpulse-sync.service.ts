import { Injectable, Logger } from '@nestjs/common';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { SettingsService } from '../settings/settings.service';
import { mapSignalRowToQpulsePayload } from './qpulse-signal-mapper.util';
import type { QpulseSyncConfig } from './qpulse-sync.types';

@Injectable()
export class QpulseSyncService {
  private readonly logger = new Logger(QpulseSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cabinetContext: CabinetContextService,
    private readonly appLog: AppLogService,
  ) {}

  async getConfig(): Promise<QpulseSyncConfig> {
    const [enabledRaw, apiUrl, apiKey] = await Promise.all([
      this.settings.get('QPULSE_SYNC_ENABLED'),
      this.settings.get('QPULSE_API_URL'),
      this.settings.get('QPULSE_API_KEY'),
    ]);
    return {
      enabled: String(enabledRaw ?? '').trim().toLowerCase() === 'true',
      apiUrl: String(apiUrl ?? '').trim().replace(/\/$/, ''),
      apiKey: String(apiKey ?? '').trim(),
    };
  }

  async isSyncConfigured(): Promise<boolean> {
    const cfg = await this.getConfig();
    return cfg.enabled && cfg.apiUrl.length > 0 && cfg.apiKey.length > 0;
  }

  async getPublicConfig(): Promise<{
    enabled: boolean;
    apiUrl: string;
    apiKeyConfigured: boolean;
  }> {
    const cfg = await this.getConfig();
    return {
      enabled: cfg.enabled,
      apiUrl: cfg.apiUrl,
      apiKeyConfigured: cfg.apiKey.length > 0,
    };
  }

  async saveConfig(body: {
    enabled?: boolean;
    apiUrl?: string;
    apiKey?: string;
  }): Promise<{ ok: true }> {
    if (body.enabled !== undefined) {
      await this.settings.set('QPULSE_SYNC_ENABLED', body.enabled ? 'true' : 'false');
    }
    if (body.apiUrl !== undefined) {
      await this.settings.set('QPULSE_API_URL', String(body.apiUrl).trim());
    }
    if (body.apiKey !== undefined && String(body.apiKey).trim()) {
      await this.settings.set('QPULSE_API_KEY', String(body.apiKey).trim());
    }
    return { ok: true };
  }

  private integrationUrl(path: string, cfg: QpulseSyncConfig): string {
    const base = cfg.apiUrl.replace(/\/$/, '');
    const suffix = path.startsWith('/') ? path : `/${path}`;
    return `${base}${suffix}`;
  }

  async createSignalIfLinked(params: {
    signalId: string;
    signalRow: Parameters<typeof mapSignalRowToQpulsePayload>[0];
    cabinetId?: string | null;
  }): Promise<{ ok: boolean; qpulseId?: string; error?: string }> {
    const cabinetId =
      params.cabinetId?.trim() ||
      (params.signalRow as { cabinetId?: string | null }).cabinetId?.trim() ||
      this.cabinetContext.getCabinetId()?.trim() ||
      null;
    if (!cabinetId) {
      return { ok: false, error: 'cabinetId missing' };
    }

    return this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
    const cfg = await this.getConfig();
    if (!cfg.enabled || !cfg.apiUrl || !cfg.apiKey) {
      return { ok: false, error: 'QPulse sync disabled or not configured' };
    }
    const prismaAny = this.prisma as any;
    const existing = await prismaAny.signalExternalSync.findUnique({
      where: { cabinetId_signalId: { cabinetId, signalId: params.signalId } },
    });
    if (existing?.qpulseId) {
      return { ok: true, qpulseId: existing.qpulseId };
    }

    const payload = mapSignalRowToQpulsePayload(params.signalRow);
    try {
      const res = await fetch(this.integrationUrl('/integrations/signals', cfg), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': cfg.apiKey,
        },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok) {
        const err = body?.error ?? res.statusText ?? 'QPulse POST failed';
        await this.recordSyncError(cabinetId, params.signalId, err);
        return { ok: false, error: err };
      }
      const qpulseId = String(body?.id ?? '').trim() || undefined;
      await prismaAny.signalExternalSync.upsert({
        where: { cabinetId_signalId: { cabinetId, signalId: params.signalId } },
        create: {
          cabinetId,
          signalId: params.signalId,
          qpulseId: qpulseId ?? null,
          syncedAt: new Date(),
          lastError: null,
        },
        update: {
          qpulseId: qpulseId ?? undefined,
          syncedAt: new Date(),
          lastError: null,
        },
      });
      void this.appLog.append('info', 'system', 'QPulse: signal created', {
        signalId: params.signalId,
        qpulseId,
      });
      return { ok: true, qpulseId };
    } catch (e) {
      const err = formatError(e);
      await this.recordSyncError(cabinetId, params.signalId, err);
      this.logger.warn(`createSignalIfLinked ${params.signalId}: ${err}`);
      return { ok: false, error: err };
    }
    });
  }

  async patchSignalIfSynced(signalId: string): Promise<void> {
    const signalCabinet = await this.prisma.signal.findFirst({
      where: { id: signalId, deletedAt: null },
      select: { cabinetId: true },
    });
    const cabinetId =
      signalCabinet?.cabinetId?.trim() || this.cabinetContext.getCabinetId()?.trim() || null;
    if (!cabinetId) return;

    await this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
    const cfg = await this.getConfig();
    if (!cfg.enabled || !cfg.apiUrl || !cfg.apiKey) return;
    const prismaAny = this.prisma as any;
    const sync = await prismaAny.signalExternalSync.findUnique({
      where: { cabinetId_signalId: { cabinetId, signalId } },
    });
    if (!sync) return;

    const row = await this.prisma.signal.findFirst({
      where: { id: signalId, cabinetId, deletedAt: null },
      include: { orders: true },
    });
    if (!row) return;

    const payload = mapSignalRowToQpulsePayload(row as any);
    try {
      const res = await fetch(
        this.integrationUrl(`/integrations/signals/${encodeURIComponent(signalId)}`, cfg),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': cfg.apiKey,
          },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string | string[] } | null;
        const msg = Array.isArray(body?.message)
          ? body.message.join('; ')
          : String(body?.message ?? res.statusText);
        await this.recordSyncError(cabinetId, signalId, msg);
        return;
      }
      await prismaAny.signalExternalSync.update({
        where: { cabinetId_signalId: { cabinetId, signalId } },
        data: { syncedAt: new Date(), lastError: null },
      });
    } catch (e) {
      const err = formatError(e);
      await this.recordSyncError(cabinetId, signalId, err);
      this.logger.warn(`patchSignalIfSynced ${signalId}: ${err}`);
    }
    });
  }

  private async recordSyncError(
    cabinetId: string,
    signalId: string,
    error: string,
  ): Promise<void> {
    const prismaAny = this.prisma as any;
    await prismaAny.signalExternalSync
      .upsert({
        where: { cabinetId_signalId: { cabinetId, signalId } },
        create: { cabinetId, signalId, lastError: error.slice(0, 2000) },
        update: { lastError: error.slice(0, 2000) },
      })
      .catch(() => undefined);
    void this.appLog.append('warn', 'system', 'QPulse: sync failed', { signalId, error });
  }
}
