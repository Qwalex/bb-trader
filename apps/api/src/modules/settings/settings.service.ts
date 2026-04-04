import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';

import {
  parseDefaultEntryRaw,
  resolveDefaultEntryToUsd,
} from './entry-sizing.util';

const ENV_FALLBACK: Record<string, string> = {
  /** Номинал по умолчанию, если в БД и .env ключ не задан */
  DEFAULT_ORDER_USD: '10',
  /** Если true — при номинале ниже minQty биржи поднимать qty до минимума (старое поведение); иначе ошибка */
  BUMP_TO_MIN_EXCHANGE_LOT: 'false',
  /** Если true — в AppLog (БД) писать шумные события; по умолчанию false */
  APPLOG_LOG_NOISY_EVENTS: 'false',
};

const SENSITIVE_SETTING_PATTERNS = ['SECRET', 'TOKEN', 'PASSWORD', 'API_KEY', 'API_HASH', '2FA'];
const WRITE_ALLOWLIST = new Set([
  'APPLOG_LOG_NOISY_EVENTS',
  'BUMP_TO_MIN_EXCHANGE_LOT',
  'BYBIT_API_KEY_MAINNET',
  'BYBIT_API_KEY_TESTNET',
  'BYBIT_API_SECRET_MAINNET',
  'BYBIT_API_SECRET_TESTNET',
  'BYBIT_TESTNET',
  'DEFAULT_LEVERAGE',
  'DEFAULT_LEVERAGE_ENABLED',
  'DEFAULT_ORDER_USD',
  'DIAGNOSTIC_BATCH_SIZE',
  'DIAGNOSTIC_MAX_LOG_LINES',
  'MIN_CAPITAL_AMOUNT',
  'OPENROUTER_API_KEY',
  'OPENROUTER_DIAGNOSTIC_MODELS',
  'OPENROUTER_MODEL_AI_ADVISOR',
  'OPENROUTER_MODEL_AUDIO',
  'OPENROUTER_MODEL_AUDIO_FALLBACK_1',
  'OPENROUTER_MODEL_DEFAULT',
  'OPENROUTER_MODEL_HISTORY',
  'OPENROUTER_MODEL_IMAGE',
  'OPENROUTER_MODEL_IMAGE_FALLBACK_1',
  'OPENROUTER_MODEL_TEXT',
  'OPENROUTER_MODEL_TEXT_FALLBACK_1',
  'POLLING_INTERVAL_MS',
  'SIGNAL_SOURCE',
  'SOURCE_EXCLUDE_LIST',
  'SOURCE_LIST',
  'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
  'STATS_RESET_AT',
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_NOTIFY_API_TRADE_CANCELLED',
  'TELEGRAM_USERBOT_2FA_PASSWORD',
  'TELEGRAM_USERBOT_API_HASH',
  'TELEGRAM_USERBOT_API_ID',
  'TELEGRAM_USERBOT_CANCEL_STALE_ORDERS_ON_RESULT_WITHOUT_ENTRY',
  'TELEGRAM_USERBOT_ENABLED',
  'TELEGRAM_USERBOT_MIN_BALANCE_USD',
  'TELEGRAM_USERBOT_NOTIFY_FAILURES',
  'TELEGRAM_USERBOT_NOTIFY_RESULT_WITHOUT_ENTRY',
  'TELEGRAM_USERBOT_POLL_INTERVAL_MS',
  'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION',
  'TELEGRAM_USERBOT_SESSION',
  'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
  'TELEGRAM_WHITELIST',
]);

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async get(key: string, workspaceId?: string | null): Promise<string | undefined> {
    const row = workspaceId
      ? await this.prisma.setting.findUnique({ where: { workspaceId_key: { workspaceId, key } } })
      : null;
    if (row?.value !== undefined && row?.value !== '') {
      return row.value;
    }
    const fromEnv = this.config.get<string>(key);
    if (fromEnv !== undefined && fromEnv !== '') {
      return fromEnv;
    }
    const fromProcess = process.env[key];
    if (fromProcess !== undefined && fromProcess !== '') {
      return fromProcess;
    }
    return ENV_FALLBACK[key];
  }

  /**
   * Номинал позиции в USDT, если в сигнале не заданы ни сумма, ни % депозита.
   * Строка настройки: число USDT ("10") или процент от equity ("10%").
   * Для режима % нужен balanceTotalUsd (суммарный USDT на счёте); иначе — fallback 10.
   */
  async getDefaultOrderUsd(balanceTotalUsd?: number | null): Promise<number> {
    const raw = await this.get('DEFAULT_ORDER_USD');
    return this.resolveDefaultEntryUsdFromRaw(raw, balanceTotalUsd);
  }

  /**
   * Дефолт входа: глобальная настройка или переопределение по чату (строка как в DEFAULT_ORDER_USD).
   */
  async resolveDefaultEntryUsd(opts: {
    rawOverride?: string | null;
    balanceTotalUsd?: number | null;
  }): Promise<number> {
    const raw =
      opts.rawOverride != null && String(opts.rawOverride).trim() !== ''
        ? String(opts.rawOverride).trim()
        : await this.get('DEFAULT_ORDER_USD');
    return this.resolveDefaultEntryUsdFromRaw(raw, opts.balanceTotalUsd);
  }

  resolveDefaultEntryUsdFromRaw(
    raw: string | undefined,
    balanceTotalUsd?: number | null,
  ): number {
    const spec = parseDefaultEntryRaw(raw);
    const fbRaw = ENV_FALLBACK.DEFAULT_ORDER_USD ?? '10';
    const fbSpec = parseDefaultEntryRaw(fbRaw);
    const fallbackUsd =
      fbSpec.kind === 'fixed' && fbSpec.usd > 0 ? fbSpec.usd : 10;
    return resolveDefaultEntryToUsd(spec, balanceTotalUsd, fallbackUsd);
  }

  async set(key: string, value: string): Promise<void> {
    const workspaceId = process.env.BOOTSTRAP_WORKSPACE_ID?.trim();
    if (!workspaceId) {
      throw new Error('BOOTSTRAP_WORKSPACE_ID is required until full tenant context wiring is complete');
    }
    if (!SettingsService.canWriteKey(key)) {
      throw new Error(`Unsupported setting key: ${key}`);
    }
    await this.prisma.setting.upsert({
      where: { workspaceId_key: { workspaceId, key } },
      create: { workspaceId, key, value },
      update: { value },
    });
  }

  async getMany(keys: string[]): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    for (const k of keys) {
      out[k] = await this.get(k);
    }
    return out;
  }

  async list(): Promise<{ key: string; value: string }[]> {
    const workspaceId = process.env.BOOTSTRAP_WORKSPACE_ID?.trim();
    if (!workspaceId) {
      return [];
    }
    return this.prisma.setting.findMany({
      where: { workspaceId },
      orderBy: { key: 'asc' },
    });
  }

  async getManyResolved(keys: string[]): Promise<{ key: string; value: string }[]> {
    const uniqueKeys = Array.from(new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0)));
    const rows = await Promise.all(
      uniqueKeys.map(async (key) => {
        const value = await this.get(key);
        return { key, value: value ?? '' };
      }),
    );
    return rows.sort((a, b) => a.key.localeCompare(b.key, 'ru'));
  }

  static isSensitiveKey(key: string): boolean {
    const upper = key.trim().toUpperCase();
    return SENSITIVE_SETTING_PATTERNS.some((part) => upper.includes(part));
  }

  static redactValue(key: string, value: string): string {
    if (!SettingsService.isSensitiveKey(key)) {
      return value;
    }
    return value ? '***' : '';
  }

  static canWriteKey(key: string): boolean {
    return WRITE_ALLOWLIST.has(key.trim());
  }

  /**
   * Полная очистка SQLite: ордера, сигналы, логи, настройки в БД.
   * Переменные окружения не трогаются.
   */
  async resetAllData(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.diagnosticStepResult.deleteMany();
      await tx.diagnosticLog.deleteMany();
      await tx.diagnosticModelResult.deleteMany();
      await tx.diagnosticCase.deleteMany();
      await tx.diagnosticRun.deleteMany();
      await tx.order.deleteMany();
      await tx.signal.deleteMany();
      await tx.appLog.deleteMany();
      await tx.setting.deleteMany();
    });
  }
}
