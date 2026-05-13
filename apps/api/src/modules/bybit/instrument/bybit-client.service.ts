import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5, WebsocketClient } from 'bybit-api';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { SettingsService } from '../../settings/settings.service';

type BybitAuthCredentials = {
  key: string;
  secret: string;
  testnet: boolean;
};

@Injectable()
export class BybitClientService {
  private readonly logger = new Logger(BybitClientService.name);
  private wsClient: WebsocketClient | null = null;
  private wsStarted = false;
  /** Один REST-клиент на кабинет при неизменных ключах — снижает аллокации и RSS при частом poll. */
  private readonly restClientByCabinet = new Map<
    string,
    { fingerprint: string; client: RestClientV5 }
  >();

  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private static normalizeSettingValue(value: string | undefined): string | undefined {
    if (value === undefined) {
      return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const hasMatchingQuotes =
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"));
    const unwrapped = hasMatchingQuotes ? trimmed.slice(1, -1).trim() : trimmed;
    return unwrapped || undefined;
  }

  async getBybitCredentials(): Promise<BybitAuthCredentials | null> {
    const testnet =
      BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_TESTNET'),
      )?.toLowerCase() === 'true';
    let key: string | undefined;
    let secret: string | undefined;
    if (testnet) {
      key = BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_KEY_TESTNET'),
      );
      secret = BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_SECRET_TESTNET'),
      );
    } else {
      key = BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_KEY_MAINNET'),
      );
      secret = BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_SECRET_MAINNET'),
      );
    }
    if (!key || !secret) {
      return null;
    }
    return { key, secret, testnet };
  }

  private static tradingCredentialsFingerprint(creds: BybitAuthCredentials): string {
    return createHash('sha256')
      .update(`${creds.testnet ? '1' : '0'}\0${creds.key}\0${creds.secret}`, 'utf8')
      .digest('hex');
  }

  private restClientCabinetKey(): string {
    return this.cabinetContext.getCabinetId() ?? '__global__';
  }

  private disposeRestClient(client: RestClientV5): void {
    const c = client as unknown as { closeAll?: () => void; close?: () => void };
    try {
      c.closeAll?.();
    } catch {
      // ignore
    }
    try {
      c.close?.();
    } catch {
      // ignore
    }
  }

  async getClient(): Promise<RestClientV5 | null> {
    const creds = await this.getBybitCredentials();
    if (!creds) {
      return null;
    }
    const cabinetKey = this.restClientCabinetKey();
    const fingerprint = BybitClientService.tradingCredentialsFingerprint(creds);
    let entry = this.restClientByCabinet.get(cabinetKey);
    if (entry?.fingerprint === fingerprint) {
      return entry.client;
    }
    const client = new RestClientV5({
      key: creds.key,
      secret: creds.secret,
      testnet: creds.testnet,
    });
    entry = this.restClientByCabinet.get(cabinetKey);
    if (entry?.fingerprint === fingerprint) {
      this.disposeRestClient(client);
      return entry.client;
    }
    if (entry) {
      this.disposeRestClient(entry.client);
    }
    this.restClientByCabinet.set(cabinetKey, { fingerprint, client });
    return client;
  }

  /** Глобальные ключи только для private WS (env / глобальный `Setting`), без контекста кабинета. */
  private async getDedicatedPrivateWsCredentials(): Promise<BybitAuthCredentials | null> {
    const testnet =
      BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_TESTNET'),
      )?.toLowerCase() === 'true';
    const key = BybitClientService.normalizeSettingValue(
      await this.settings.get('BYBIT_PRIVATE_WS_API_KEY'),
    );
    const secret = BybitClientService.normalizeSettingValue(
      await this.settings.get('BYBIT_PRIVATE_WS_API_SECRET'),
    );
    if (!key || !secret) {
      return null;
    }
    return { key, secret, testnet };
  }

  /**
   * Ключи для единственного глобального private WS: сначала `BYBIT_PRIVATE_WS_*`, затем торговые ключи дефолтного кабинета (UI), затем прежняя глобальная цепочка без кабинета.
   */
  private async resolveCredentialsForPrivateWs(): Promise<BybitAuthCredentials | null> {
    const dedicated = await this.getDedicatedPrivateWsCredentials();
    if (dedicated) {
      this.logger.log('bybit private ws: using BYBIT_PRIVATE_WS_* credentials');
      return dedicated;
    }
    const defaultCabinetId = await this.cabinets.getDefaultCabinetId();
    const fromDefaultCabinet = await this.cabinetContext.runWithCabinetAsync(
      defaultCabinetId,
      () => this.getBybitCredentials(),
    );
    if (fromDefaultCabinet) {
      this.logger.log(
        `bybit private ws: using default cabinet trading keys (cabinet=${defaultCabinetId})`,
      );
      return fromDefaultCabinet;
    }
    return this.getBybitCredentials();
  }

  /**
   * @returns `true` если WS поднят или осознанно отключён (не повторять); `false` если ключей ещё нет / init упал — можно повторить позже.
   */
  async startPrivateWsSync(params: {
    onWsUpdate: () => Promise<void>;
  }): Promise<boolean> {
    if (this.wsStarted) {
      return true;
    }
    try {
      const creds = await this.resolveCredentialsForPrivateWs();
      if (!creds) {
        this.logger.log('bybit ws disabled: no credentials');
        return false;
      }
      const enabledRaw = String(
        (await this.settings.get('BYBIT_WS_SYNC_ENABLED')) ?? 'true',
      )
        .trim()
        .toLowerCase();
      if (enabledRaw === 'false' || enabledRaw === '0' || enabledRaw === 'off') {
        this.logger.log('bybit ws sync disabled by BYBIT_WS_SYNC_ENABLED');
        this.wsStarted = true;
        return true;
      }

      const multiPolicy = String(
        (await this.settings.get('BYBIT_WS_MULTI_CABINET')) ?? 'auto',
      )
        .trim()
        .toLowerCase();
      const cabinetCount = await this.prisma.cabinet.count();
      if (cabinetCount > 1 && multiPolicy !== 'force') {
        this.logger.log(
          `bybit ws disabled: ${cabinetCount} cabinets (один глобальный private WS не покрывает все ключи; polling остаётся; BYBIT_WS_MULTI_CABINET=force — прежнее поведение)`,
        );
        this.wsStarted = true;
        return true;
      }

      this.wsClient = new WebsocketClient({
        key: creds.key,
        secret: creds.secret,
        testnet: creds.testnet,
      });
      void this.wsClient.subscribeV5(['order', 'position'], 'linear');
      (this.wsClient as any).on('update', (evt: unknown) => {
        void this.handleWsUpdate(evt, params.onWsUpdate);
      });
      (this.wsClient as any).on('open', () => {
        this.logger.log('bybit private ws connected');
      });
      (this.wsClient as any).on('close', () => {
        this.logger.warn('bybit private ws disconnected');
      });
      (this.wsClient as any).on('error', (err: unknown) => {
        this.logger.warn(`bybit ws error: ${formatError(err)}`);
      });
      this.wsStarted = true;
      return true;
    } catch (e) {
      try {
        const c = this.wsClient as { closeAll?: () => void } | null;
        c?.closeAll?.();
      } catch {
        // ignore
      }
      this.wsClient = null;
      this.logger.warn(`bybit ws init failed: ${formatError(e)}`);
      return false;
    }
  }

  private async handleWsUpdate(
    evt: unknown,
    onWsUpdate: () => Promise<void>,
  ): Promise<void> {
    try {
      const raw = evt as Record<string, unknown>;
      const topic = String(raw?.topic ?? '').toLowerCase();
      if (!topic.includes('order') && !topic.includes('position')) {
        return;
      }
      await onWsUpdate();
    } catch (e) {
      this.logger.debug(`bybit ws update handling failed: ${formatError(e)}`);
    }
  }
}
