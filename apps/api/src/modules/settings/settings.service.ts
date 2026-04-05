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

/** JSON-массив id пунктов меню, которые показываются в бургере (остальные — в полоске). */
export const NAV_MENU_IN_BURGER_KEY = 'NAV_MENU_IN_BURGER';
/** JSON-массив ключей настроек, видимых и редактируемых только app-admin. */
export const SETTINGS_KEYS_ADMIN_ONLY_KEY = 'SETTINGS_KEYS_ADMIN_ONLY';

const META_ADMIN_ONLY_SETTING_KEYS = new Set<string>([
  NAV_MENU_IN_BURGER_KEY,
  SETTINGS_KEYS_ADMIN_ONLY_KEY,
]);

/** Должен совпадать с id в `apps/web/lib/nav-items.ts` (NAV_ITEMS). */
const VALID_NAV_MENU_ITEM_IDS = new Set<string>([
  'dashboard',
  'trades',
  'logs',
  'ai',
  'diagnostics',
  'telegram-userbot',
  'my-group',
  'filters',
  'workspaces',
  'settings',
]);

/** Если в БД нет NAV_MENU_IN_BURGER — компактное меню по умолчанию. */
export const DEFAULT_NAV_MENU_IN_BURGER_IDS: readonly string[] = [
  'logs',
  'ai',
  'diagnostics',
  'telegram-userbot',
  'my-group',
  'filters',
  'workspaces',
];

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
  NAV_MENU_IN_BURGER_KEY,
  SETTINGS_KEYS_ADMIN_ONLY_KEY,
]);

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private resolveWorkspaceId(workspaceId?: string | null): string | undefined {
    const explicit = workspaceId?.trim();
    if (explicit) {
      return explicit;
    }
    const fallback = process.env.BOOTSTRAP_WORKSPACE_ID?.trim();
    return fallback || undefined;
  }

  async get(key: string, workspaceId?: string | null): Promise<string | undefined> {
    const resolvedWorkspaceId = this.resolveWorkspaceId(workspaceId);
    const row = resolvedWorkspaceId
      ? await this.prisma.setting.findUnique({
          where: { workspaceId_key: { workspaceId: resolvedWorkspaceId, key } },
        })
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

  async set(key: string, value: string, workspaceId?: string | null): Promise<void> {
    const resolvedWorkspaceId = this.resolveWorkspaceId(workspaceId);
    if (!resolvedWorkspaceId) {
      throw new Error('BOOTSTRAP_WORKSPACE_ID is required until full tenant context wiring is complete');
    }
    if (!SettingsService.canWriteKey(key)) {
      throw new Error(`Unsupported setting key: ${key}`);
    }
    await this.prisma.setting.upsert({
      where: { workspaceId_key: { workspaceId: resolvedWorkspaceId, key } },
      create: { workspaceId: resolvedWorkspaceId, key, value },
      update: { value },
    });
  }

  async getMany(
    keys: string[],
    workspaceId?: string | null,
  ): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    for (const k of keys) {
      out[k] = await this.get(k, workspaceId);
    }
    return out;
  }

  async list(workspaceId?: string | null): Promise<{ key: string; value: string }[]> {
    const resolvedWorkspaceId = this.resolveWorkspaceId(workspaceId);
    if (!resolvedWorkspaceId) {
      return [];
    }
    return this.prisma.setting.findMany({
      where: { workspaceId: resolvedWorkspaceId },
      orderBy: { key: 'asc' },
    });
  }

  async getManyResolved(
    keys: string[],
    workspaceId?: string | null,
  ): Promise<{ key: string; value: string }[]> {
    const uniqueKeys = Array.from(new Set(keys.map((key) => key.trim()).filter((key) => key.length > 0)));
    const rows = await Promise.all(
      uniqueKeys.map(async (key) => {
        const value = await this.get(key, workspaceId);
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

  static isMetaAdminOnlySettingKey(key: string): boolean {
    return META_ADMIN_ONLY_SETTING_KEYS.has(key.trim());
  }

  static validateNavMenuInBurgerJson(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('NAV_MENU_IN_BURGER: ожидается JSON-массив строк');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('NAV_MENU_IN_BURGER: значение должно быть JSON-массивом');
    }
    for (const item of parsed) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('NAV_MENU_IN_BURGER: каждый элемент — непустая строка (id пункта)');
      }
      const id = item.trim();
      if (!VALID_NAV_MENU_ITEM_IDS.has(id)) {
        throw new Error(`NAV_MENU_IN_BURGER: неизвестный id «${id}»`);
      }
    }
  }

  static validateSettingsKeysAdminOnlyJson(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('SETTINGS_KEYS_ADMIN_ONLY: ожидается JSON-массив строк');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('SETTINGS_KEYS_ADMIN_ONLY: значение должно быть JSON-массивом');
    }
    for (const item of parsed) {
      if (typeof item !== 'string' || !item.trim()) {
        throw new Error('SETTINGS_KEYS_ADMIN_ONLY: каждый элемент — непустая строка (ключ настройки)');
      }
      const k = item.trim();
      if (!SettingsService.canWriteKey(k)) {
        throw new Error(`SETTINGS_KEYS_ADMIN_ONLY: ключ «${k}» не в списке разрешённых для записи`);
      }
      if (META_ADMIN_ONLY_SETTING_KEYS.has(k)) {
        throw new Error(`SETTINGS_KEYS_ADMIN_ONLY: ключ «${k}» нельзя включать в список`);
      }
    }
  }

  private async getRawSettingRowFromDb(
    workspaceId: string,
    key: string,
  ): Promise<{ value: string } | null> {
    return this.prisma.setting.findUnique({
      where: { workspaceId_key: { workspaceId, key } },
      select: { value: true },
    });
  }

  /**
   * Id пунктов в бургере. Если строки в БД нет — дефолтный компактный набор.
   * Пустой JSON-массив [] означает «все пункты в полоске».
   */
  async getNavMenuInBurgerIds(workspaceId: string): Promise<string[]> {
    const row = await this.getRawSettingRowFromDb(workspaceId, NAV_MENU_IN_BURGER_KEY);
    if (!row || !row.value.trim()) {
      return [...DEFAULT_NAV_MENU_IN_BURGER_IDS];
    }
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) {
        return [...DEFAULT_NAV_MENU_IN_BURGER_IDS];
      }
      return parsed
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((id) => VALID_NAV_MENU_ITEM_IDS.has(id));
    } catch {
      return [...DEFAULT_NAV_MENU_IN_BURGER_IDS];
    }
  }

  private async getExtraAdminOnlyKeysFromDb(workspaceId: string): Promise<string[]> {
    const row = await this.getRawSettingRowFromDb(workspaceId, SETTINGS_KEYS_ADMIN_ONLY_KEY);
    if (!row?.value?.trim()) {
      return [];
    }
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((x) => (typeof x === 'string' ? x.trim() : ''))
        .filter((k) => k.length > 0 && SettingsService.canWriteKey(k));
    } catch {
      return [];
    }
  }

  /** Ключи настроек, скрытые от не-админов (мета + список из БД). */
  async buildAdminOnlySettingKeysSet(workspaceId: string): Promise<Set<string>> {
    const out = new Set<string>(META_ADMIN_ONLY_SETTING_KEYS);
    const extra = await this.getExtraAdminOnlyKeysFromDb(workspaceId);
    for (const k of extra) {
      if (!META_ADMIN_ONLY_SETTING_KEYS.has(k)) {
        out.add(k);
      }
    }
    return out;
  }

  /**
   * Полная очистка данных текущего workspace в БД.
   * Переменные окружения не трогаются.
   */
  async resetAllData(workspaceId?: string | null): Promise<void> {
    const resolvedWorkspaceId = this.resolveWorkspaceId(workspaceId);
    if (!resolvedWorkspaceId) {
      throw new Error('Workspace id is required');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.diagnosticStepResult.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
      await tx.diagnosticLog.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
      await tx.diagnosticModelResult.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
      await tx.diagnosticCase.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
      await tx.diagnosticRun.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
      await tx.order.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
      await tx.signal.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
      await tx.appLog.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
      await tx.setting.deleteMany({ where: { workspaceId: resolvedWorkspaceId } });
    });
  }
}
