/**
 * Целое число шагов qtyStep в qty (без этого 0.3/0.1 в JS даёт 2.999… → floor = 2).
 */
export function floorQtyToStepUnits(qty: number, stepNum: number): number {
  if (!Number.isFinite(qty) || !Number.isFinite(stepNum) || stepNum <= 0) {
    return 0;
  }
  return Math.floor(qty / stepNum + 1e-9);
}

/** Округление количества к шагу лота (без подмешивания min на каждый кусок — это ломало split). */
export function formatQtyToStep(qty: number, qtyStep: string): string {
  const stepNum = parseFloat(qtyStep);
  if (!Number.isFinite(stepNum) || stepNum <= 0) {
    return String(qty);
  }
  const units = floorQtyToStepUnits(qty, stepNum);
  const floored = units * stepNum;
  const decimals = (qtyStep.split('.')[1] ?? '').length;
  return floored.toFixed(decimals);
}

/** Цена лимитки по tickSize инструмента. */
export function formatPriceToTick(price: number, tickSize: string): string {
  const tick = parseFloat(tickSize);
  if (!Number.isFinite(tick) || tick <= 0) {
    return String(price);
  }
  const rounded = Math.round(price / tick) * tick;
  const decimals = (tickSize.split('.')[1] ?? '').length;
  return rounded.toFixed(decimals);
}

/** Цена на сетке тика — для сравнения с LastPrice (Rising/Falling требуют строгого неравенства). */
export function snapPriceToTickNum(price: number, tickSize: string): number {
  const tick = parseFloat(tickSize);
  if (!Number.isFinite(tick) || tick <= 0) {
    return price;
  }
  return Math.round(price / tick) * tick;
}

export function roundQty(qty: number, step: string, minQty: string): string {
  const stepNum = parseFloat(step);
  const min = parseFloat(minQty);
  const roundedDown = floorQtyToStepUnits(qty, stepNum) * stepNum;
  const q = Math.max(roundedDown, min);
  const decimals = (step.split('.')[1] ?? '').length;
  return q.toFixed(decimals);
}
