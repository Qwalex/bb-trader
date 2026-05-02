import type { LiveExposurePosition } from './bybit.types';

/**
 * Hedge: по символу две строки позиции (Buy / Sell). Берём ту, что соответствует сигналу.
 * One-way: обычно одна строка с ненулевым size.
 */
export function pickPositionRowForSignalDirection(
  rows: Array<{
    size?: string;
    side?: string;
    positionIdx?: number;
    stopLoss?: string;
  }>,
  direction: 'long' | 'short',
):
  | {
      size?: string;
      side?: string;
      positionIdx?: number;
      stopLoss?: string;
    }
  | undefined {
  const wantBuy = direction === 'long';
  const withSize = rows.filter((r) => {
    const sz = r?.size ? Math.abs(parseFloat(String(r.size))) : 0;
    return sz > 1e-12;
  });
  const matched = withSize.find((r) => {
    const side = String(r.side ?? '').toLowerCase();
    const isBuy = side === 'buy';
    return wantBuy === isBuy;
  });
  if (matched) {
    return matched;
  }
  if (withSize.length === 1) {
    const side = String(withSize[0]?.side ?? '').toLowerCase();
    if (side === 'buy' || side === 'sell') {
      return undefined;
    }
    return withSize[0];
  }
  return withSize[0];
}

export function pickLiveExposurePositionForDirection(
  positions: LiveExposurePosition[],
  direction: 'long' | 'short',
): LiveExposurePosition | undefined {
  const wantSide = direction === 'long' ? 'buy' : 'sell';
  const matched = positions.find(
    (row) => String(row.side ?? '').trim().toLowerCase() === wantSide,
  );
  if (matched) {
    return matched;
  }
  if (positions.length === 1) {
    const only = positions[0];
    const side = String(only?.side ?? '').trim().toLowerCase();
    if (side === 'buy' || side === 'sell') {
      return undefined;
    }
    return only;
  }
  return undefined;
}
