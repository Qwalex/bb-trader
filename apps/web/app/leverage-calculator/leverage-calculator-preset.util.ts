import {
  LEVERAGE_CALCULATOR_PRESET_KEY,
  PRESET_JSON_MAX_LEN,
} from './leverage-calculator-page.constants';
import type { LeverageCalculatorPresetV1 } from './leverage-calculator-page.types';
import type { LeverageCalcMode } from './leverage-calculator-page.util';
import { todayIsoDateOnly } from './leverage-calculator-page.util';

export const DEFAULT_LEVERAGE_PRESET: LeverageCalculatorPresetV1 = {
  v: 1,
  principalUsd: 650,
  monthlyPaymentUsd: 40,
  termYears: 2,
  horizonMonthsAfterLoan: 12,
  mode: 'expected',
  loanStartIso: '',
};

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function isMode(x: unknown): x is LeverageCalcMode {
  return x === 'expected' || x === 'realized';
}

/** Разбор JSON из БД; при ошибке — null. */
export function parseLeveragePresetJson(raw: string | undefined | null): LeverageCalculatorPresetV1 | null {
  const t = String(raw ?? '').trim();
  if (!t) return null;
  try {
    const j = JSON.parse(t) as Record<string, unknown>;
    if (j.v !== 1) return null;
    const principalUsd = clamp(Number(j.principalUsd), 0, 1e9);
    const monthlyPaymentUsd = clamp(Number(j.monthlyPaymentUsd), 0, 1e9);
    const termYears = clamp(Number(j.termYears), 0.08, 80);
    const horizonMonthsAfterLoan = clamp(Math.round(Number(j.horizonMonthsAfterLoan)), 0, 600);
    const mode: LeverageCalcMode = isMode(j.mode) ? j.mode : 'expected';
    let loanStartIso = typeof j.loanStartIso === 'string' ? j.loanStartIso.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(loanStartIso)) {
      loanStartIso = todayIsoDateOnly();
    }
    return {
      v: 1,
      principalUsd,
      monthlyPaymentUsd,
      termYears,
      horizonMonthsAfterLoan,
      mode,
      loanStartIso,
    };
  } catch {
    return null;
  }
}

export function buildPresetFromFormState(input: {
  principalUsd: number;
  monthlyPaymentUsd: number;
  termYears: number;
  horizonMonthsAfterLoan: number;
  mode: LeverageCalcMode;
  loanStartIso: string;
}): LeverageCalculatorPresetV1 {
  let loanStartIso = input.loanStartIso.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(loanStartIso)) {
    loanStartIso = todayIsoDateOnly();
  }
  return {
    v: 1,
    principalUsd: clamp(input.principalUsd, 0, 1e9),
    monthlyPaymentUsd: clamp(input.monthlyPaymentUsd, 0, 1e9),
    termYears: clamp(input.termYears, 0.08, 80),
    horizonMonthsAfterLoan: clamp(Math.round(input.horizonMonthsAfterLoan), 0, 600),
    mode: input.mode,
    loanStartIso,
  };
}

export function serializeLeveragePreset(p: LeverageCalculatorPresetV1): string {
  const body = JSON.stringify(p);
  if (body.length > PRESET_JSON_MAX_LEN) {
    throw new Error('PRESET_TOO_LARGE');
  }
  return body;
}

export { LEVERAGE_CALCULATOR_PRESET_KEY };
