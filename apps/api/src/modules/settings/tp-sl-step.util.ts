/**
 * Режим подтягивания SL после TP: с какого номера TP начинать лестницу (BE → предыдущие TP).
 * `tp1` — как раньше при TP_SL_STEP_ENABLED=true; `off` — выкл.
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
    return 'tp1';
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

export type SourceTpSlStepMap = Record<string, TpSlStepStartMode>;

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
