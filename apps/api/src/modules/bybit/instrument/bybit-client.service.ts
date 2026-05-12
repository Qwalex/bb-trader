import { Injectable, Logger } from '@nestjs/common';
import { RestClientV5, WebsocketClient } from 'bybit-api';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';

@Injectable()
export class BybitClientService {
  private readonly logger = new Logger(BybitClientService.name);
  private wsClient: WebsocketClient | null = null;
  private wsStarted = false;

  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
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

  async getBybitCredentials(): Promise<{
    key: string;
    secret: string;
    testnet: boolean;
  } | null> {
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

  async getClient(): Promise<RestClientV5 | null> {
    const creds = await this.getBybitCredentials();
    if (!creds) {
      return null;
    }
    return new RestClientV5({
      key: creds.key,
      secret: creds.secret,
      testnet: creds.testnet,
    });
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
      const creds = await this.getBybitCredentials();
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
