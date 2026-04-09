/**
 * Режим подтягивания SL после TP: с какого номера TP начинать лестницу (BE → предыдущие TP).
 * `tp1` — лестница с первого TP; `tp2` — зазор в 1 TP (до второго не двигаем SL), затем BE и далее по предыдущим TP.
 * Устаревшее `TP_SL_STEP_ENABLED=true` и значения `true`/`1` в парсере — по умолчанию `tp2`; `off` — выкл.
 *
 * Диапазон (`TP_SL_STEP_RANGE`, 1..5): на сколько уровней TP «назад» от текущего счётчика
 * исполненных TP выбирается цена SL после старта (после первого шага — безубыток). Пусто или не задано —
 * равен номеру стартового TP (прежняя модель: старт tp2 ⇒ диапазон 2).
 */
export type TpSlStepStartMode = 'off' | 'tp1' | 'tp2' | 'tp3' | 'tp4' | 'tp5';

const VALID: ReadonlySet<string> = new Set([
  'off',
  'tp1',
  'tp2',
  'tp3',
  'tp4',
  'tp5',
]);

export function parseTpSlStepStart(
  raw: string | undefined | null,
): TpSlStepStartMode {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === '' || s === 'false' || s === '0') {
    return 'off';
  }
  if (VALID.has(s)) {
    return s as TpSlStepStartMode;
  }
  if (s === 'true' || s === '1') {
    return 'tp2';
  }
  return 'off';
}

/** Номер TP (1..5), с которого начинается лестница; для `off` — 0. */
export function tpSlStepStartToTpNumber(mode: TpSlStepStartMode): number {
  if (mode === 'off') {
    return 0;
  }
  return Number.parseInt(mode.slice(2), 10);
}

/**
 * Глобальный диапазон из настройки `TP_SL_STEP_RANGE`: целое 1..5 или `null` (наследовать: равен старту).
 */
export function parseTpSlStepRangeOptional(
  raw: string | undefined | null,
): number | null {
  const s = String(raw ?? '').trim();
  if (s === '') {
    return null;
  }
  /** Как при сохранении: только одна цифра 1–5, без «3x» / «12» от parseInt */
  if (!/^[1-5]$/.test(s)) {
    return null;
  }
  return Number.parseInt(s, 10);
}

/**
 * Элемент JSON `SOURCE_TP_SL_STEP_RANGE`: целое **число** 1–5 или **строка** из одной цифры 1–5
 * (как глобальный `TP_SL_STEP_RANGE`). Иначе `null` — без `parseInt("3x")`, дробей и т.п.
 */
export function parseTpSlStepRangeJsonValue(v: unknown): number | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || Math.trunc(v) !== v) {
      return null;
    }
    if (v < 1 || v > 5) {
      return null;
    }
    return v;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!/^[1-5]$/.test(s)) {
      return null;
    }
    return Number.parseInt(s, 10);
  }
  return null;
}

/**
 * Сохранение `TP_SL_STEP_RANGE`: пусто или ровно одна цифра 1–5.
 * Иначе — исключение (через {@link getTpSlStepRangePersistError}).
 */
export function normalizeTpSlStepRangeForPersist(raw: string): string {
  const err = getTpSlStepRangePersistError(raw);
  if (err) {
    throw new Error(err);
  }
  return String(raw ?? '').trim();
}

/** Текст ошибки или `null`, если значение допустимо; для UI/API. */
export function getTpSlStepRangePersistError(raw: string): string | null {
  const s = String(raw ?? '').trim();
  if (s === '') {
    return null;
  }
  if (!/^[1-5]$/.test(s)) {
    return `TP_SL_STEP_RANGE: ожидается пустая строка (диапазон = старт) или одна цифра 1–5, сейчас: ${JSON.stringify(s)}`;
  }
  return null;
}

/**
 * Сохранение JSON `SOURCE_TP_SL_STEP_RANGE`: объект с целами 1..5 по ключам.
 */
export function normalizeSourceTpSlStepRangeJsonForPersist(raw: string): string {
  const err = getSourceTpSlStepRangeJsonPersistError(raw);
  if (err) {
    throw new Error(err);
  }
  const text = String(raw ?? '').trim();
  if (text === '') {
    return '{}';
  }
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed)) {
    const key = String(k ?? '').trim().toLowerCase();
    if (!key) {
      continue;
    }
    const n = parseTpSlStepRangeJsonValue(v);
    if (n === null) {
      throw new Error(
        `SOURCE_TP_SL_STEP_RANGE: для ключа ${JSON.stringify(key)} ожидается целое 1–5 или строка одной цифры 1–5`,
      );
    }
    out[key] = n;
  }
  return JSON.stringify(out);
}

export function getSourceTpSlStepRangeJsonPersistError(raw: string): string | null {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return null;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return 'SOURCE_TP_SL_STEP_RANGE: ожидается JSON-объект { "имя_чата": 1..5, ... }';
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k ?? '').trim().toLowerCase();
      if (!key) {
        continue;
      }
      if (parseTpSlStepRangeJsonValue(v) === null) {
        return `SOURCE_TP_SL_STEP_RANGE: для ключа ${JSON.stringify(key)} ожидается целое 1–5 или строка одной цифры 1–5`;
      }
    }
  } catch {
    return 'SOURCE_TP_SL_STEP_RANGE: невалидный JSON';
  }
  return null;
}

/**
 * Итоговый диапазон: явное значение 1..5 или, если `null`/`undefined`, — `startNum`.
 */
export function resolveEffectiveTpSlRange(
  startNum: number,
  explicitRange: number | null | undefined,
): number {
  const r = explicitRange;
  if (r !== null && r !== undefined && Number.isFinite(r)) {
    const n = Math.trunc(r as number);
    if (n >= 1 && n <= 5) {
      return n;
    }
  }
  return startNum;
}

export type SourceTpSlStepMap = Record<string, TpSlStepStartMode>;

/** Переопределение диапазона по источнику: ключ — имя чата lower, значение — 1..5. */
export type SourceTpSlStepRangeMap = Record<string, number>;

export function parseSourceTpSlStepRangeMap(
  raw: string | undefined | null,
): SourceTpSlStepRangeMap {
  const out: SourceTpSlStepRangeMap = {};
  const text = String(raw ?? '').trim();
  if (!text) {
    return out;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return out;
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k ?? '').trim().toLowerCase();
      if (!key) {
        continue;
      }
      const n = parseTpSlStepRangeJsonValue(v);
      if (n !== null) {
        out[key] = n;
      }
    }
  } catch {
    return {};
  }
  return out;
}

export function parseSourceTpSlStepMap(
  raw: string | undefined | null,
): SourceTpSlStepMap {
  const out: SourceTpSlStepMap = {};
  const text = String(raw ?? '').trim();
  if (!text) {
    return out;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return out;
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k ?? '').trim().toLowerCase();
      if (!key) {
        continue;
      }
      const mode = parseTpSlStepStart(
        typeof v === 'string' ? v : String(v ?? ''),
      );
      out[key] = mode;
    }
  } catch {
    return {};
  }
  return out;
}
