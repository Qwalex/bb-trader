/**
 * Парсинг настройки дефолтного входа: фиксированный USDT или процент от equity.
 * Примеры: "10", "10.5", "10%", "15 %"
 */
export type DefaultEntrySpec =
  | { kind: 'fixed'; usd: number }
  | { kind: 'percent'; percent: number };

export function parseDefaultEntryRaw(
  raw: string | undefined | null,
): DefaultEntrySpec {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) {
    return { kind: 'fixed', usd: 10 };
  }
  const hasPercent = /%\s*$/.test(s) || s.includes('%');
  if (hasPercent) {
    const n = parseFloat(s.replace(/%/g, '').replace(',', '.').trim());
    if (Number.isFinite(n) && n > 0) {
      return { kind: 'percent', percent: Math.min(n, 100) };
    }
    return { kind: 'fixed', usd: 10 };
  }
  const n = parseFloat(s.replace(',', '.'));
  if (Number.isFinite(n) && n > 0) {
    return { kind: 'fixed', usd: n };
  }
  return { kind: 'fixed', usd: 10 };
}

/**
 * Equity в USDT — «полный» баланс (total), как в getUnifiedUsdtBalanceDetails().totalUsd.
 */
export function resolveDefaultEntryToUsd(
  spec: DefaultEntrySpec,
  balanceTotalUsd: number | null | undefined,
  fallbackUsd: number,
): number {
  if (spec.kind === 'fixed') {
    return spec.usd;
  }
  const b =
    balanceTotalUsd != null &&
    Number.isFinite(balanceTotalUsd) &&
    balanceTotalUsd > 0
      ? balanceTotalUsd
      : 0;
  if (b <= 0) {
    return fallbackUsd;
  }
  const v = (b * spec.percent) / 100;
  return Number.isFinite(v) && v > 0 ? v : fallbackUsd;
}
