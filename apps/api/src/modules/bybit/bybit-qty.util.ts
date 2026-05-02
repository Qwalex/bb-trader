export function floorQtyToStepUnits(qty: number, stepNum: number): number {
  return Math.floor(qty / stepNum + 1e-12);
}

export function formatQtyToStep(qty: number, qtyStep: string): string {
  const stepNum = parseFloat(qtyStep);
  if (!Number.isFinite(stepNum) || stepNum <= 0) return String(qty);
  const units = floorQtyToStepUnits(qty, stepNum);
  return (units * stepNum).toFixed(qtyStep.split('.')[1]?.length ?? 0);
}

export function formatPriceToTick(price: number, tickSize: string): string {
  const tick = parseFloat(tickSize);
  if (!Number.isFinite(tick) || tick <= 0) return String(price);
  const steps = Math.round(price / tick);
  const snapped = steps * tick;
  return snapped.toFixed(tickSize.split('.')[1]?.length ?? 0);
}

export function snapPriceToTickNum(price: number, tickSize: string): number {
  return parseFloat(formatPriceToTick(price, tickSize));
}

export function entryNotionalWeights(entryCount: number): number[] {
  if (entryCount <= 0) return [];
  if (entryCount === 1) return [1];
  const first = 0.5;
  const restEach = (1 - first) / (entryCount - 1);
  return Array.from({ length: entryCount }, (_, i) => (i === 0 ? first : restEach));
}

export function splitPositionQtyForTps(params: {
  totalQtyBase: number;
  tpCount: number;
  qtyStep: string;
  minQty: string;
}): string[] {
  const { totalQtyBase, tpCount, qtyStep, minQty } = params;
  const stepNum = parseFloat(qtyStep);
  const min = parseFloat(minQty);
  if (tpCount <= 0 || totalQtyBase <= 0 || !Number.isFinite(stepNum) || stepNum <= 0) {
    return [];
  }
  const totalUnits = floorQtyToStepUnits(totalQtyBase, stepNum);
  const totalFloored = totalUnits * stepNum;
  if (!Number.isFinite(totalFloored) || totalFloored < min) {
    return [];
  }
  const baseUnits = Math.floor(totalUnits / tpCount);
  const baseQty = baseUnits * stepNum;
  if (!Number.isFinite(baseQty) || baseQty < min) {
    return [];
  }
  const outUnits = Array.from({ length: tpCount }, () => baseUnits);
  let remainderUnits = totalUnits - baseUnits * tpCount;
  for (let i = 0; i < tpCount && remainderUnits > 0; i += 1) {
    outUnits[i] = (outUnits[i] ?? 0) + 1;
    remainderUnits -= 1;
  }
  return outUnits.map((u) => formatQtyToStep(u * stepNum, qtyStep));
}

export function splitQtyForChildOrders(params: {
  totalQtyBase: number;
  childCount: number;
  qtyStep: string;
  minQty: string;
}): string[] {
  const { totalQtyBase, childCount, qtyStep, minQty } = params;
  if (childCount <= 1) {
    const one = formatQtyToStep(totalQtyBase, qtyStep);
    return parseFloat(one) > 0 ? [one] : [];
  }
  const parts = splitPositionQtyForTps({
    totalQtyBase,
    tpCount: childCount,
    qtyStep,
    minQty,
  }).filter((q) => parseFloat(q) > 0);
  if (parts.length > 0) {
    return parts;
  }
  const one = formatQtyToStep(totalQtyBase, qtyStep);
  return parseFloat(one) > 0 ? [one] : [];
}

export function buildTpSplitDiagnostics(params: {
  posSize: number;
  requestedLevels: number;
  qtyStep: string;
  minQty: string;
}): {
  posSizeRounded: string;
  totalUnits: number;
  qtyStepNum: number | null;
  minQtyNum: number | null;
  reasons: string[];
} {
  const qtyStepNum = parseFloat(params.qtyStep);
  const minQtyNum = parseFloat(params.minQty);
  const posSizeRounded = formatQtyToStep(params.posSize, params.qtyStep);
  const totalUnits =
    Number.isFinite(qtyStepNum) && qtyStepNum > 0
      ? floorQtyToStepUnits(params.posSize, qtyStepNum)
      : 0;
  const reasons: string[] = [];
  if (!Number.isFinite(qtyStepNum) || qtyStepNum <= 0) reasons.push('invalid_qty_step');
  if (!Number.isFinite(minQtyNum) || minQtyNum <= 0) reasons.push('invalid_min_qty');
  if (Number.isFinite(minQtyNum) && parseFloat(posSizeRounded) < minQtyNum) {
    reasons.push('position_below_min_qty');
  }
  if (params.requestedLevels > 1 && totalUnits > 0 && Number.isFinite(minQtyNum) && minQtyNum > 0) {
    const unitsPerLevel = Math.floor(totalUnits / params.requestedLevels);
    const qtyPerLevel = unitsPerLevel * qtyStepNum;
    if (!Number.isFinite(qtyPerLevel) || qtyPerLevel < minQtyNum) {
      reasons.push('per_tp_qty_below_min_qty');
    }
  }
  return {
    posSizeRounded,
    totalUnits,
    qtyStepNum: Number.isFinite(qtyStepNum) ? qtyStepNum : null,
    minQtyNum: Number.isFinite(minQtyNum) ? minQtyNum : null,
    reasons,
  };
}
