import type { SignalDto } from '@repo/shared';

/** Значения, которые LLM ошибочно кладёт в source вместо канала/приложения. */
const INVALID_SOURCE_TOKENS = new Set(['text', 'image', 'audio']);

/**
 * Убирает из source ошибочные значения (тип сообщения вместо канала).
 * Возвращает undefined, если строка пустая или недопустима.
 */
export function sanitizeSignalSource(raw: string | undefined): string | undefined {
  if (raw == null || typeof raw !== 'string') return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  if (INVALID_SOURCE_TOKENS.has(t.toLowerCase())) return undefined;
  return t;
}

/** Нормализует произвольный объект из LLM в Partial<SignalDto>. */
export function normalizePartialSignal(raw: unknown): Partial<SignalDto> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const o = raw as Record<string, unknown>;
  const out: Partial<SignalDto> = {};

  if (typeof o.pair === 'string' && o.pair.trim()) {
    out.pair = o.pair.trim().toUpperCase();
  }
  if (o.direction === 'long' || o.direction === 'short') {
    out.direction = o.direction;
  }
  if (Array.isArray(o.entries)) {
    const nums = o.entries
      .map((x) => (typeof x === 'number' ? x : parseFloat(String(x))))
      .filter((n) => !Number.isNaN(n));
    if (nums.length) out.entries = nums;
  }
  if (o.entryIsRange === true || o.entryIsRange === false) {
    out.entryIsRange = Boolean(o.entryIsRange);
  }
  if (typeof o.stopLoss === 'number' && !Number.isNaN(o.stopLoss)) {
    out.stopLoss = o.stopLoss;
  } else if (o.stopLoss != null) {
    const n = parseFloat(String(o.stopLoss));
    if (!Number.isNaN(n)) out.stopLoss = n;
  }
  if (Array.isArray(o.takeProfits)) {
    const nums = o.takeProfits
      .map((x) => (typeof x === 'number' ? x : parseFloat(String(x))))
      .filter((n) => !Number.isNaN(n));
    if (nums.length) out.takeProfits = nums;
  }
  if (typeof o.leverage === 'number' && !Number.isNaN(o.leverage)) {
    out.leverage = o.leverage;
  } else if (o.leverage != null) {
    const n = parseFloat(String(o.leverage));
    if (!Number.isNaN(n)) out.leverage = n;
  }
  if (Array.isArray(o.leverageRange)) {
    const nums = o.leverageRange
      .map((x) => (typeof x === 'number' ? x : parseFloat(String(x))))
      .filter((n) => !Number.isNaN(n));
    if (nums.length >= 2) {
      out.leverageRange = [nums[0]!, nums[1]!];
    }
  }
  if (typeof o.capitalPercent === 'number' && !Number.isNaN(o.capitalPercent)) {
    out.capitalPercent = o.capitalPercent;
  } else if (o.capitalPercent != null) {
    const n = parseFloat(String(o.capitalPercent));
    if (!Number.isNaN(n)) out.capitalPercent = n;
  }
  if (typeof o.orderUsd === 'number' && !Number.isNaN(o.orderUsd)) {
    out.orderUsd = o.orderUsd;
  } else if (o.orderUsd != null) {
    const n = parseFloat(String(o.orderUsd));
    if (!Number.isNaN(n)) out.orderUsd = n;
  }
  const src = sanitizeSignalSource(
    typeof o.source === 'string' ? o.source : undefined,
  );
  if (src) out.source = src;

  return out;
}

export function mergePartialSignals(
  a: Partial<SignalDto> | undefined,
  b: Partial<SignalDto> | undefined,
): Partial<SignalDto> {
  return { ...a, ...b };
}

/** Политика поля leverage: обязательно из сообщения или подстановка из настроек. */
export type LeverageFieldOptions = {
  /** true — плечо должно быть в сигнале; false — при отсутствии подставляется defaultLeverage */
  requireLeverage: boolean;
  /** Используется при requireLeverage === false, если в partial нет валидного плеча (>= 1) */
  defaultLeverage?: number;
  /** Принудительное плечо (карточка userbot «Прин.» или FORCED_LEVERAGE) — перекрывает сигнал и дефолт */
  forcedLeverage?: number;
  /** Режим выбора плеча из диапазона. */
  leverageRangeMode?: 'min' | 'max' | 'mid';
  /** Минимально допустимое плечо (кроме forced). */
  minAllowedLeverage?: number;
  /** Максимально допустимое плечо (кроме forced). */
  maxAllowedLeverage?: number;
};

/** Какие поля ещё нужны для полного SignalDto. */
export function listMissingRequiredFields(
  p: Partial<SignalDto>,
  leverageOpts?: LeverageFieldOptions,
): string[] {
  const missing: string[] = [];
  if (!p.pair?.trim()) missing.push('pair');
  if (!p.direction) missing.push('direction');
  if (p.stopLoss === undefined || Number.isNaN(Number(p.stopLoss))) {
    missing.push('stopLoss');
  }
  if (!p.takeProfits?.length) missing.push('takeProfits');

  const forced = leverageOpts?.forcedLeverage;
  if (forced != null && forced >= 1) {
    /* плечо задаётся политикой принудительной настройки */
  } else {
    const requireLev = leverageOpts?.requireLeverage ?? true;
    if (requireLev) {
      if (p.leverage === undefined || p.leverage < 1) missing.push('leverage');
    } else {
      const def = leverageOpts?.defaultLeverage;
      const hasValidLeverage =
        p.leverage !== undefined && !Number.isNaN(Number(p.leverage)) && p.leverage >= 1;
      if (!hasValidLeverage && (def === undefined || def < 1)) {
        missing.push('leverage');
      }
    }
  }
  return missing;
}

export function isCompletePartial(
  p: Partial<SignalDto>,
  leverageOpts?: LeverageFieldOptions,
): p is SignalDto {
  if (listMissingRequiredFields(p, leverageOpts).length > 0) {
    return false;
  }
  return true;
}

/** Человекочитаемые подписи полей (для подсказок). */
export function fieldLabelRu(key: string): string {
  const map: Record<string, string> = {
    pair: 'торговая пара (например BTCUSDT)',
    direction: 'направление long или short',
    entries: 'цены входа (одна или несколько для DCA)',
    stopLoss: 'стоп-лосс (цена)',
    takeProfits: 'тейк-профиты (одна или несколько цен)',
    leverage: 'плечо (число, например 10)',
    leverageRange: 'диапазон плеча [min, max], например [5, 15]',
    orderUsd:
      'сумма позиции в USDT (номинал); если не задана — значение из настроек DEFAULT_ORDER_USD',
    capitalPercent:
      'доля баланса в %: 1–100 — маржа, номинал × плечо; выше 100 — номинал как % от баланса (напр. 500 → 5× баланс в USDT)',
    entryIsRange: 'одна зона входа (две границы), не DCA',
  };
  return map[key] ?? key;
}
