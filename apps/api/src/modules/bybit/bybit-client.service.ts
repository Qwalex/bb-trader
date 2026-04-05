import { Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { SettingsService } from '../settings/settings.service';

@Injectable()
export class BybitClientService {
  private readonly clientCache = new Map<string, RestClientV5>();

  constructor(private readonly settings: SettingsService) {}

  /**
   * Нормализует строковые настройки из .env/SQLite:
   * - убирает внешние пробелы;
   * - снимает парные кавычки (часто появляются после copy/paste).
   */
  static normalizeSettingValue(value: string | undefined): string | undefined {
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

  /**
   * Выбирает ключи по флагу BYBIT_TESTNET:
   * — testnet: BYBIT_API_KEY_TESTNET / BYBIT_API_SECRET_TESTNET;
   * — mainnet: BYBIT_API_KEY_MAINNET / BYBIT_API_SECRET_MAINNET.
   */
  async getBybitCredentials(workspaceId?: string | null): Promise<{
    key: string;
    secret: string;
    testnet: boolean;
  } | null> {
    const testnet =
      BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_TESTNET', workspaceId),
      )?.toLowerCase() === 'true';
    let key: string | undefined;
    let secret: string | undefined;
    if (testnet) {
      key = BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_KEY_TESTNET', workspaceId),
      );
      secret = BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_SECRET_TESTNET', workspaceId),
      );
    } else {
      key = BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_KEY_MAINNET', workspaceId),
      );
      secret = BybitClientService.normalizeSettingValue(
        await this.settings.get('BYBIT_API_SECRET_MAINNET', workspaceId),
      );
    }
    if (!key || !secret) {
      return null;
    }
    return { key, secret, testnet };
  }

  async getClient(workspaceId?: string | null): Promise<RestClientV5 | null> {
    const creds = await this.getBybitCredentials(workspaceId);
    if (!creds) {
      return null;
    }
    const cacheKey = `${String(creds.testnet)}:${creds.key}`;
    const cached = this.clientCache.get(cacheKey);
    if (cached) return cached;
    const client = new RestClientV5({
      key: creds.key,
      secret: creds.secret,
      testnet: creds.testnet,
    });
    this.clientCache.set(cacheKey, client);
    return client;
  }

  /** Сбросить кешированные клиенты (вызывать при изменении API-ключей в настройках). */
  invalidateClientCache(): void {
    this.clientCache.clear();
  }
}
