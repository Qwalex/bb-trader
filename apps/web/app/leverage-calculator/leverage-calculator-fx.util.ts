import type { LeverageInputCurrency } from './leverage-calculator-page.types';

export type RubUsdRateResponse =
  | { ok: true; rubPerUsd: number; date: string; source: string }
  | { ok: false; error: string };

export function rubFromUsd(usd: number | null | undefined, rubPerUsd: number | null): number | null {
  if (usd == null || !Number.isFinite(usd) || rubPerUsd == null || !Number.isFinite(rubPerUsd) || rubPerUsd <= 0) {
    return null;
  }
  return usd * rubPerUsd;
}

export function usdFromRub(rub: number, rubPerUsd: number): number {
  return rub / rubPerUsd;
}

export function parseMoneyInput(raw: string): number {
  const normalized = String(raw ?? '')
    .replace(/[\u00A0\u202F\s]/g, '')
    .replace(',', '.')
    .trim();
  if (normalized.length === 0) return 0;
  const v = Number.parseFloat(normalized);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Резервный курс RUB за 1 USD для страницы кредитного калькулятора, если `GET /api/fx/rub-usd` недоступен
 * (сеть, блокировка внешнего API и т.п.). Задаётся при сборке Next.js.
 */
export function readLeverageRubPerUsdFromEnv(): number | null {
  if (typeof process === 'undefined' || process.env == null) return null;
  const raw = process.env.NEXT_PUBLIC_LEVERAGE_RUB_PER_USD;
  if (raw == null || String(raw).trim() === '') return null;
  const v = Number.parseFloat(String(raw).replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Сумма в USDT из поля ввода: при валюте RUB — делим на курс. */
export function loanFieldUsd(
  raw: string,
  currency: LeverageInputCurrency,
  rubPerUsd: number | null,
): number {
  const v = parseMoneyInput(raw);
  if (currency === 'RUB' && rubPerUsd != null && rubPerUsd > 0) {
    return v / rubPerUsd;
  }
  return v;
}

export function formatRubAmount(rub: number | null | undefined, digits = 0): string {
  if (rub == null || !Number.isFinite(rub)) return '—';
  return `${rub.toLocaleString('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  })} ₽`;
}

export function formatRubSigned(rub: number | null | undefined, digits = 0): string {
  if (rub == null || !Number.isFinite(rub)) return '—';
  const sign = rub > 0 ? '+' : rub < 0 ? '−' : '';
  const abs = Math.abs(rub);
  const body = abs.toLocaleString('ru-RU', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
  return `${sign}${body} ₽`;
}
