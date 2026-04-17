export type LeverageRangeMode = 'min' | 'max' | 'mid';

export type LeveragePolicy = {
  rangeMode: LeverageRangeMode;
  minAllowed?: number;
  maxAllowed?: number;
};

export function parseLeverageRangeMode(
  raw: string | undefined,
): LeverageRangeMode {
  const t = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (t === 'min' || t === 'max' || t === 'mid') {
    return t;
  }
  return 'mid';
}

export function parseOptionalLeverageInt(
  raw: string | number | null | undefined,
): number | undefined {
  if (raw === null || raw === undefined) {
    return undefined;
  }
  const t = String(raw).trim().replace(',', '.');
  if (!t) {
    return undefined;
  }
  const n = Number(t);
  if (!Number.isFinite(n) || n < 1) {
    return undefined;
  }
  return Math.round(n);
}

export function pickLeverageFromRange(
  lowRaw: number,
  highRaw: number,
  mode: LeverageRangeMode,
): number {
  const low = Math.min(lowRaw, highRaw);
  const high = Math.max(lowRaw, highRaw);
  if (mode === 'min') {
    return low;
  }
  if (mode === 'max') {
    return high;
  }
  return Math.round((low + high) / 2);
}

export function clampLeverageByPolicy(
  leverage: number,
  policy: LeveragePolicy,
): number {
  let out = leverage;
  if (policy.minAllowed != null && out < policy.minAllowed) {
    out = policy.minAllowed;
  }
  if (policy.maxAllowed != null && out > policy.maxAllowed) {
    out = policy.maxAllowed;
  }
  return out;
}

export function resolveEffectiveLeverage(params: {
  baseLeverage: number;
  leverageRange?: [number, number];
  forcedLeverage?: number;
  policy: LeveragePolicy;
}): number {
  if (params.forcedLeverage != null && params.forcedLeverage >= 1) {
    return Math.round(params.forcedLeverage);
  }
  const normalizedBase = Math.max(1, Math.round(params.baseLeverage));
  const fromRange =
    params.leverageRange && params.leverageRange.length === 2
      ? pickLeverageFromRange(
          params.leverageRange[0],
          params.leverageRange[1],
          params.policy.rangeMode,
        )
      : normalizedBase;
  return clampLeverageByPolicy(Math.max(1, Math.round(fromRange)), params.policy);
}
