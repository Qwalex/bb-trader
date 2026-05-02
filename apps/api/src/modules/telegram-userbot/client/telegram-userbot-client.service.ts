import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { NewMessage } from 'telegram/events';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as QRCode from 'qrcode';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';
import type { QrState } from '../telegram-userbot.types';

@Injectable()
export class TelegramUserbotClientService {
  private readonly logger = new Logger(TelegramUserbotClientService.name);
  private readonly clientsByUserId = new Map<string, TelegramClient>();
  private readonly messageHandlerRegisteredByUserId = new Set<string>();
  private readonly qrClientByUserId = new Map<string, TelegramClient>();
  private readonly qrTaskByUserId = new Map<string, Promise<void>>();
  private readonly qrStateByUserId = new Map<string, QrState>();

  private inboundHandler: ((event: unknown) => Promise<void>) | null = null;
  private afterAttachHook: (() => Promise<void>) | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  setInboundHandler(handler: (event: unknown) => Promise<void>): void {
    this.inboundHandler = handler;
  }

  /** Вызывается после успешного attach (например refresh enabled chats на фасаде). */
  setAfterAttachHook(hook: () => Promise<void>): void {
    this.afterAttachHook = hook;
  }

  async getOwnerUserId(): Promise<string | null> {
    const cabinetId = this.cabinetContext.getCabinetId();
    if (!cabinetId) {
      return null;
    }
    const row = await this.prisma.cabinet.findUnique({
      where: { id: cabinetId },
      select: { ownerUserId: true },
    });
    return String(row?.ownerUserId ?? '').trim() || null;
  }

  async isClientOwnedByCurrentUser(): Promise<boolean> {
    const currentOwnerUserId = await this.getOwnerUserId();
    if (!currentOwnerUserId) return false;
    return this.clientsByUserId.has(currentOwnerUserId);
  }

  async getCurrentUserClient(): Promise<TelegramClient | null> {
    const currentOwnerUserId = await this.getOwnerUserId();
    if (!currentOwnerUserId) return null;
    return this.clientsByUserId.get(currentOwnerUserId) ?? null;
  }

  getQrStateForUser(userId: string | null): QrState {
    if (!userId) return { phase: 'idle' };
    return this.qrStateByUserId.get(userId) ?? { phase: 'idle' };
  }

  setQrStateForUser(userId: string | null, next: Partial<QrState>) {
    if (!userId) return;
    const now = new Date().toISOString();
    const prev = this.getQrStateForUser(userId);
    this.qrStateByUserId.set(userId, {
      ...prev,
      ...next,
      startedAt: prev.startedAt ?? now,
      updatedAt: now,
    });
  }

  getConnectedClientsCount(): number {
    return this.clientsByUserId.size;
  }

  *clientsEntries(): IterableIterator<[string, TelegramClient]> {
    yield* this.clientsByUserId.entries();
  }

  async connectFromStoredSession(): Promise<
    { ok: true; connected: true } | { ok: false; error: string }
  > {
    const currentOwnerUserId = await this.getOwnerUserId();
    if (!currentOwnerUserId) {
      return { ok: false, error: 'Пользователь не определен для кабинета' };
    }
    const creds = await this.getApiCreds();
    const clientOptions = await this.getTelegramClientOptions();
    const session = (await this.settings.get('TELEGRAM_USERBOT_SESSION'))?.trim();
    if (!session) {
      return {
        ok: false,
        error: 'Сессия userbot не найдена. Запустите вход по QR.',
      };
    }
    await this.stopQrClient(currentOwnerUserId);
    const client = new TelegramClient(
      new StringSession(session),
      creds.apiId,
      creds.apiHash,
      clientOptions,
    );
    await client.connect();
    const authorized = await this.isClientAuthorized(client);
    if (!authorized) {
      await client.disconnect();
      return {
        ok: false,
        error: 'Сессия недействительна. Выполните повторный вход по QR.',
      };
    }
    await this.attachClient(client);
    await this.settings.set('TELEGRAM_USERBOT_ENABLED', 'true');
    return { ok: true, connected: true };
  }

  async disconnect(): Promise<{ ok: true; connected: false }> {
    const currentOwnerUserId = await this.getOwnerUserId();
    if (!currentOwnerUserId) {
      return { ok: true, connected: false };
    }
    const client = this.clientsByUserId.get(currentOwnerUserId);
    if (!client) {
      return { ok: true, connected: false };
    }
    try {
      await client.disconnect();
    } finally {
      this.clientsByUserId.delete(currentOwnerUserId);
      this.messageHandlerRegisteredByUserId.delete(currentOwnerUserId);
    }
    return { ok: true, connected: false };
  }

  async startQrLogin(): Promise<
    | { ok: true; message?: string; qr: QrState }
    | { ok: false; error: string; qr?: QrState }
  > {
    const ownerUserId = await this.getOwnerUserId();
    const currentClient = await this.getCurrentUserClient();
    if ((await this.isClientOwnedByCurrentUser()) && (await this.isClientAuthorized(currentClient))) {
      return {
        ok: true,
        message: 'Userbot уже авторизован.',
        qr: this.getQrStateForUser(ownerUserId),
      };
    }
    if (ownerUserId && this.qrTaskByUserId.get(ownerUserId)) {
      return { ok: true, message: 'QR-вход уже запущен.', qr: this.getQrStateForUser(ownerUserId) };
    }

    const creds = await this.getApiCreds();
    const clientOptions = await this.getTelegramClientOptions();
    await this.stopQrClient(ownerUserId);
    const qrClient = new TelegramClient(
      new StringSession(''),
      creds.apiId,
      creds.apiHash,
      clientOptions,
    );
    await qrClient.connect();
    if (!ownerUserId) {
      return { ok: false, error: 'Пользователь не определен для кабинета' };
    }
    this.qrClientByUserId.set(ownerUserId, qrClient);
    this.setQrStateForUser(ownerUserId, { phase: 'starting' });

    const qrTask = (async () => {
      try {
        await qrClient.signInUserWithQrCode(
          { apiId: creds.apiId, apiHash: creds.apiHash },
          {
            onError: async (err: unknown) => {
              const msg = formatError(err);
              this.logger.warn(`Userbot QR onError: ${msg}`);
              this.setQrStateForUser(ownerUserId, { phase: 'error', error: msg });
              return false;
            },
            qrCode: async (code: { token: Buffer }) => {
              const loginUrl = `tg://login?token=${code.token.toString('base64url')}`;
              const qrDataUrl = await QRCode.toDataURL(loginUrl);
              this.setQrStateForUser(ownerUserId, {
                phase: 'waiting_scan',
                loginUrl,
                qrDataUrl,
              });
            },
            password: async () =>
              (await this.settings.get('TELEGRAM_USERBOT_2FA_PASSWORD')) ?? '',
          },
        );
        const authorized = await this.isClientAuthorized(qrClient);
        if (!authorized) {
          this.setQrStateForUser(ownerUserId, {
            phase: 'error',
            error: 'QR авторизация не завершена.',
          });
          return;
        }
        const savedSession = (
          qrClient.session as unknown as { save: () => string }
        ).save();
        await this.settings.set('TELEGRAM_USERBOT_SESSION', savedSession);
        await this.settings.set('TELEGRAM_USERBOT_ENABLED', 'true');
        await this.attachClient(qrClient);
        this.qrClientByUserId.delete(ownerUserId);
        this.setQrStateForUser(ownerUserId, { phase: 'authorized' });
      } catch (e) {
        const msg = formatError(e);
        this.logger.error(`Userbot QR flow failed: ${msg}`);
        this.setQrStateForUser(ownerUserId, { phase: 'error', error: msg });
        await this.stopQrClient(ownerUserId);
      } finally {
        this.qrTaskByUserId.delete(ownerUserId);
      }
    })();
    this.qrTaskByUserId.set(ownerUserId, qrTask);

    return { ok: true, qr: this.getQrStateForUser(ownerUserId) };
  }

  async getQrStatus(): Promise<{
    connected: boolean;
    qr: QrState;
    inProgress: boolean;
  }> {
    const ownerUserId = await this.getOwnerUserId();
    const sameUserClient = await this.isClientOwnedByCurrentUser();
    const client = await this.getCurrentUserClient();
    return {
      connected: sameUserClient && (await this.isClientAuthorized(client)),
      qr: this.getQrStateForUser(ownerUserId),
      inProgress: Boolean(ownerUserId && this.qrTaskByUserId.get(ownerUserId)),
    };
  }

  async cancelQrLogin(): Promise<{ ok: true; qr: QrState }> {
    const ownerUserId = await this.getOwnerUserId();
    await this.stopQrClient(ownerUserId);
    if (ownerUserId) {
      this.qrTaskByUserId.delete(ownerUserId);
      this.setQrStateForUser(ownerUserId, { phase: 'cancelled' });
    }
    return { ok: true, qr: this.getQrStateForUser(ownerUserId) };
  }

  async isClientAuthorized(client: TelegramClient | null): Promise<boolean> {
    if (!client) {
      return false;
    }
    try {
      const res = await client.checkAuthorization();
      return res === true;
    } catch {
      return false;
    }
  }

  async disconnectAll(): Promise<void> {
    for (const userId of Array.from(this.clientsByUserId.keys())) {
      const client = this.clientsByUserId.get(userId);
      if (!client) continue;
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
    for (const userId of Array.from(this.qrClientByUserId.keys())) {
      const client = this.qrClientByUserId.get(userId);
      if (!client) continue;
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
  }

  private async attachClient(client: TelegramClient): Promise<void> {
    const ownerUserId = await this.getOwnerUserId();
    if (!ownerUserId) {
      throw new BadRequestException('Пользователь не определен для кабинета');
    }
    const prev = this.clientsByUserId.get(ownerUserId);
    if (prev && prev !== client) {
      await prev.disconnect();
      this.messageHandlerRegisteredByUserId.delete(ownerUserId);
    }
    this.clientsByUserId.set(ownerUserId, client);
    if (!this.messageHandlerRegisteredByUserId.has(ownerUserId)) {
      const handler = this.inboundHandler;
      if (handler) {
        client.addEventHandler(handler, new NewMessage({ incoming: true }));
        this.messageHandlerRegisteredByUserId.add(ownerUserId);
      } else {
        this.logger.warn('TelegramUserbotClientService: inboundHandler не задан до addEventHandler');
      }
    }
    if (this.afterAttachHook) {
      await this.afterAttachHook();
    }
  }

  private async stopQrClient(userId: string | null): Promise<void> {
    if (!userId) {
      return;
    }
    const client = this.qrClientByUserId.get(userId);
    if (!client) return;
    try {
      await client.disconnect();
    } finally {
      this.qrClientByUserId.delete(userId);
    }
  }

  private async getApiCreds(): Promise<{ apiId: number; apiHash: string }> {
    const apiIdRaw = (await this.settings.get('TELEGRAM_USERBOT_API_ID'))?.trim();
    const apiHash = (await this.settings.get('TELEGRAM_USERBOT_API_HASH'))?.trim();
    const apiId = apiIdRaw ? parseInt(apiIdRaw, 10) : Number.NaN;
    if (!Number.isFinite(apiId) || !apiHash) {
      throw new Error(
        'Нужно заполнить TELEGRAM_USERBOT_API_ID и TELEGRAM_USERBOT_API_HASH в настройках.',
      );
    }
    return { apiId, apiHash };
  }

  private async getTelegramClientOptions(): Promise<Record<string, unknown>> {
    const options: Record<string, unknown> = { connectionRetries: 5 };
    const mtProxy = await this.getMtProxyConfig();
    if (mtProxy) {
      options.proxy = mtProxy;
    }
    return options;
  }

  private async getMtProxyConfig(): Promise<
    { ip: string; port: number; secret: string; MTProxy: true } | null
  > {
    const raw = (await this.settings.get('TELEGRAM_USERBOT_MTPROXY_URL'))?.trim();
    if (!raw) {
      return null;
    }

    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new Error(
        'Неверный TELEGRAM_USERBOT_MTPROXY_URL: ожидается ссылка вида https://t.me/proxy?server=...&port=...&secret=...',
      );
    }

    const server = url.searchParams.get('server')?.trim() ?? '';
    const secret = url.searchParams.get('secret')?.trim() ?? '';
    const portRaw = url.searchParams.get('port')?.trim() ?? '';
    const port = Number.parseInt(portRaw, 10);

    if (!server || !secret || !Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error(
        'Неверный TELEGRAM_USERBOT_MTPROXY_URL: нужны параметры server, port (1..65535) и secret.',
      );
    }

    return {
      ip: server,
      port,
      secret,
      MTProxy: true,
    };
  }
}
