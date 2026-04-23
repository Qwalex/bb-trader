import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';

import {
  parseDefaultEntryRaw,
  resolveDefaultEntryToUsd,
} from './entry-sizing.util';
import {
  normalizeSourceTpSlStepRangeJsonForPersist,
  normalizeSourceTpSlStepStartJsonForPersist,
  normalizeTpSlStepRangeForPersist,
  normalizeTpSlStepStartForPersist,
} from './tp-sl-step.util';

/** JSON-массив заметок на дашборде: `{ id, text }[]` */
export const DASHBOARD_TODOS_SETTING_KEY = 'DASHBOARD_TODOS';

export type DashboardTodoItemDto = { id: string; text: string };

const DASHBOARD_TODOS_MAX_ITEMS = 200;
const DASHBOARD_TODOS_MAX_ID_LEN = 80;
const DASHBOARD_TODOS_MAX_TEXT_LEN = 4000;

const ENV_FALLBACK: Record<string, string> = {
  /** Запись логов в таблицу AppLog (false — полностью отключить) */
  APPLOG_ENABLED: 'true',
  /** Номинал по умолчанию, если в БД и .env ключ не задан */
  DEFAULT_ORDER_USD: '10',
  /** Если true — при номинале ниже minQty биржи поднимать qty до минимума (старое поведение); иначе ошибка */
  BUMP_TO_MIN_EXCHANGE_LOT: 'false',
  /** Если true — в AppLog (БД) писать шумные события; по умолчанию false */
  APPLOG_LOG_NOISY_EVENTS: 'false',
  /**
   * Пусто — эффективный диапазон подтягивания SL = номер стартового TP (как при пустой строке в БД).
   */
  TP_SL_STEP_RANGE: '',
};

const CABINET_SCOPED_KEYS = new Set<string>([
  'BYBIT_TESTNET',
  'BYBIT_API_KEY_MAINNET',
  'BYBIT_API_SECRET_MAINNET',
  'BYBIT_API_KEY_TESTNET',
  'BYBIT_API_SECRET_TESTNET',
  'DEFAULT_ORDER_USD',
  'MIN_CAPITAL_AMOUNT',
  'BUMP_TO_MIN_EXCHANGE_LOT',
  'DEFAULT_LEVERAGE_ENABLED',
  'DEFAULT_LEVERAGE',
  'FORCED_LEVERAGE',
  'LEVERAGE_RANGE_MODE',
  'MIN_ALLOWED_LEVERAGE',
  'MAX_ALLOWED_LEVERAGE',
  'SIGNAL_SOURCE',
  'TELEGRAM_WHITELIST',
  'TELEGRAM_NOTIFY_API_TRADE_CANCELLED',
  'TELEGRAM_NOTIFY_TRADE_EVENTS',
  'TELEGRAM_NOTIFY_TRADE_EVENT_TYPES',
  'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
  'SOURCE_MARTINGALE_MULTIPLIERS',
  'SOURCE_TP_SL_STEP_START',
  'SOURCE_TP_SL_STEP_RANGE',
]);

@Injectable()
export class SettingsService {
  private static readonly COMPROMISED_SECRET_KEYS = [
    'BYBIT_API_KEY_MAINNET',
    'BYBIT_API_SECRET_MAINNET',
    'BYBIT_API_KEY_TESTNET',
    'BYBIT_API_SECRET_TESTNET',
    'OPENROUTER_API_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_USERBOT_API_HASH',
    'TELEGRAM_USERBOT_2FA_PASSWORD',
    'TELEGRAM_USERBOT_SESSION',
    'TELEGRAM_USERBOT_MTPROXY_URL',
  ] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  private isCabinetScopedKey(key: string): boolean {
    return CABINET_SCOPED_KEYS.has(key);
  }

  async get(key: string): Promise<string | undefined> {
    const cabinetId = this.currentCabinetId();
    if (cabinetId && this.isCabinetScopedKey(key)) {
      const scoped = await this.prisma.cabinetSetting.findUnique({
        where: { cabinetId_key: { cabinetId, key } },
        select: { value: true },
      });
      if (scoped?.value !== undefined && scoped.value !== '') {
        return scoped.value;
      }
    }
    const row = await this.prisma.setting.findUnique({ where: { key } });
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
    let normalized = value;
    try {
      if (key === 'TP_SL_STEP_RANGE') {
        normalized = normalizeTpSlStepRangeForPersist(value);
      } else if (key === 'TP_SL_STEP_START') {
        normalized = normalizeTpSlStepStartForPersist(value);
      } else if (key === 'SOURCE_TP_SL_STEP_RANGE') {
        normalized = normalizeSourceTpSlStepRangeJsonForPersist(value);
      } else if (key === 'SOURCE_TP_SL_STEP_START') {
        normalized = normalizeSourceTpSlStepStartJsonForPersist(value);
      } else if (key === 'FORCED_LEVERAGE') {
        const t = value.trim();
        if (t === '') {
          normalized = '';
        } else {
          const n = Number(t.replace(',', '.'));
          if (!Number.isFinite(n) || n < 1) {
            throw new BadRequestException(
              'FORCED_LEVERAGE: ожидается целое число ≥ 1 или пустая строка (выкл.)',
            );
          }
          normalized = String(Math.round(n));
        }
      } else if (key === 'LEVERAGE_RANGE_MODE') {
        const t = value.trim().toLowerCase();
        if (t === '') {
          normalized = 'mid';
        } else if (t === 'min' || t === 'max' || t === 'mid') {
          normalized = t;
        } else {
          throw new BadRequestException(
            'LEVERAGE_RANGE_MODE: ожидается min, max или mid',
          );
        }
      } else if (key === 'MIN_ALLOWED_LEVERAGE' || key === 'MAX_ALLOWED_LEVERAGE') {
        const t = value.trim();
        if (t === '') {
          normalized = '';
        } else {
          const n = Number(t.replace(',', '.'));
          if (!Number.isFinite(n) || n < 1) {
            throw new BadRequestException(
              `${key}: ожидается целое число ≥ 1 или пустая строка (выкл.)`,
            );
          }
          normalized = String(Math.round(n));
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(msg);
    }

    if (key === 'MIN_ALLOWED_LEVERAGE' || key === 'MAX_ALLOWED_LEVERAGE') {
      const otherKey =
        key === 'MIN_ALLOWED_LEVERAGE'
          ? 'MAX_ALLOWED_LEVERAGE'
          : 'MIN_ALLOWED_LEVERAGE';
      const parse = (raw: string | undefined): number | undefined => {
        const t = String(raw ?? '').trim();
        if (!t) return undefined;
        const n = Number(t.replace(',', '.'));
        return Number.isFinite(n) && n >= 1 ? Math.round(n) : undefined;
      };
      const thisVal = parse(normalized);
      const otherVal = parse(await this.get(otherKey));
      const min = key === 'MIN_ALLOWED_LEVERAGE' ? thisVal : otherVal;
      const max = key === 'MAX_ALLOWED_LEVERAGE' ? thisVal : otherVal;
      if (min != null && max != null && min > max) {
        throw new BadRequestException(
          `Ограничения плеча некорректны: MIN_ALLOWED_LEVERAGE (${min}) не может быть больше MAX_ALLOWED_LEVERAGE (${max})`,
        );
      }
    }
    const cabinetId = this.currentCabinetId();
    if (cabinetId && this.isCabinetScopedKey(key)) {
      await this.prisma.cabinetSetting.upsert({
        where: { cabinetId_key: { cabinetId, key } },
        create: { cabinetId, key, value: normalized },
        update: { value: normalized },
      });
      return;
    }
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value: normalized },
      update: { value: normalized },
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
    const cabinetId = this.currentCabinetId();
    if (!cabinetId) {
      return this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    }
    const [globalRows, scopedRows] = await Promise.all([
      this.prisma.setting.findMany({ orderBy: { key: 'asc' } }),
      this.prisma.cabinetSetting.findMany({
        where: { cabinetId },
        orderBy: { key: 'asc' },
        select: { key: true, value: true },
      }),
    ]);
    const map = new Map<string, string>();
    for (const row of globalRows) {
      map.set(row.key, row.value);
    }
    for (const row of scopedRows) {
      map.set(row.key, row.value);
    }
    return Array.from(map.entries())
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key, 'ru'));
  }

  /** Чтение только из БД (без подмешивания .env). */
  async getDashboardTodos(): Promise<DashboardTodoItemDto[]> {
    const row = await this.prisma.setting.findUnique({
      where: { key: DASHBOARD_TODOS_SETTING_KEY },
    });
    return this.parseDashboardTodosLoose(row?.value);
  }

  parseDashboardTodosLoose(raw: string | undefined | null): DashboardTodoItemDto[] {
    if (!raw?.trim()) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      const out: DashboardTodoItemDto[] = [];
      const seen = new Set<string>();
      for (const row of parsed) {
        if (!row || typeof row !== 'object') continue;
        const o = row as Record<string, unknown>;
        const id = typeof o.id === 'string' ? o.id.trim() : '';
        const text = typeof o.text === 'string' ? o.text.trim() : '';
        if (!id || !text) continue;
        if (id.length > DASHBOARD_TODOS_MAX_ID_LEN || text.length > DASHBOARD_TODOS_MAX_TEXT_LEN) {
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, text });
      }
      return out;
    } catch {
      return [];
    }
  }

  normalizeDashboardTodosPayload(input: unknown): DashboardTodoItemDto[] {
    if (!Array.isArray(input)) {
      throw new BadRequestException('items должен быть массивом');
    }
    if (input.length > DASHBOARD_TODOS_MAX_ITEMS) {
      throw new BadRequestException(`Не более ${DASHBOARD_TODOS_MAX_ITEMS} пунктов`);
    }
    const seen = new Set<string>();
    const out: DashboardTodoItemDto[] = [];
    let i = 0;
    for (const raw of input) {
      i += 1;
      if (!raw || typeof raw !== 'object') {
        throw new BadRequestException(`Пункт ${i}: ожидается объект { id, text }`);
      }
      const o = raw as Record<string, unknown>;
      const id = typeof o.id === 'string' ? o.id.trim() : '';
      const text = typeof o.text === 'string' ? o.text.trim() : '';
      if (!id || id.length > DASHBOARD_TODOS_MAX_ID_LEN) {
        throw new BadRequestException(`Пункт ${i}: некорректный id`);
      }
      if (!text) {
        throw new BadRequestException(`Пункт ${i}: текст не может быть пустым`);
      }
      if (text.length > DASHBOARD_TODOS_MAX_TEXT_LEN) {
        throw new BadRequestException(
          `Пункт ${i}: текст длиннее ${DASHBOARD_TODOS_MAX_TEXT_LEN} символов`,
        );
      }
      if (seen.has(id)) {
        throw new BadRequestException(`Пункт ${i}: повторяющийся id`);
      }
      seen.add(id);
      out.push({ id, text });
    }
    return out;
  }

  async setDashboardTodos(items: DashboardTodoItemDto[]): Promise<void> {
    await this.set(DASHBOARD_TODOS_SETTING_KEY, JSON.stringify(items));
  }

  /**
   * Полная очистка SQLite: ордера, сигналы, логи, настройки в БД.
   * Переменные окружения не трогаются.
   */
  async resetAllData(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.cabinetIngestRoute.deleteMany();
      await tx.cabinetTelegramSource.deleteMany();
      await tx.cabinetSetting.deleteMany();
      await tx.cabinetMember.deleteMany();
      await tx.diagnosticStepResult.deleteMany();
      await tx.diagnosticLog.deleteMany();
      await tx.diagnosticModelResult.deleteMany();
      await tx.diagnosticCase.deleteMany();
      await tx.diagnosticRun.deleteMany();
      await tx.order.deleteMany();
      await tx.signal.deleteMany();
      await tx.appLog.deleteMany();
      await tx.setting.deleteMany();
      await tx.cabinet.deleteMany();
    });
  }

  async purgeCompromisedSecrets(): Promise<{ updated: number; keys: string[] }> {
    let updated = 0;
    for (const key of SettingsService.COMPROMISED_SECRET_KEYS) {
      const res = await this.prisma.setting.updateMany({
        where: { key },
        data: { value: '' },
      });
      updated += res.count;
      const scoped = await this.prisma.cabinetSetting.updateMany({
        where: { key },
        data: { value: '' },
      });
      updated += scoped.count;
    }
    return {
      updated,
      keys: [...SettingsService.COMPROMISED_SECRET_KEYS],
    };
  }
}
