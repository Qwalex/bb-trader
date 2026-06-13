import {
  hasLiveTpOrders,
  hasOpenEntryOrders,
} from '../orders/bybit-order-status.util';
import { parseTakeProfitsJson } from '../orders/bybit-order-lifecycle-poll-signal.util';
import { positionHasStopLoss, positionHasTakeProfit } from '../tpsl/bybit-tpsl.util';
import { pickPositionRowForSignalDirection } from '../position/bybit-position-pick.util';
import type { StuckTradeIssue, StuckTradeIssueKind } from './bybit-stuck-trades.types';

const ISSUE_LABEL: Record<StuckTradeIssueKind, string> = {
  entry_db_stale: 'Расхождение входа БД/биржа',
  missing_sl: 'Нет stop loss',
  missing_tp: 'Нет take profit',
};

export function stuckIssueLabel(kind: StuckTradeIssueKind): string {
  return ISSUE_LABEL[kind];
}

export function classifyStuckLinearSignal(input: {
  takeProfits: string;
  stopLoss: number;
  direction: string;
  orders: Array<{ orderKind: string; status: string | null }>;
  positionSize: number;
  positionStopLoss?: string;
  positionTakeProfit?: string;
}): StuckTradeIssue[] {
  const issues: StuckTradeIssue[] = [];
  const openEntries = hasOpenEntryOrders(input.orders);
  const hasPosition = input.positionSize > 1e-12;
  const needsTp = parseTakeProfitsJson(input.takeProfits).length > 0;
  const liveTp = hasLiveTpOrders(input.orders) || positionHasTakeProfit(
    input.positionTakeProfit !== undefined ? { takeProfit: input.positionTakeProfit } : undefined,
  );
  const slConfigured = Number.isFinite(input.stopLoss) && input.stopLoss > 0;
  const posRow = input.positionStopLoss !== undefined ? { stopLoss: input.positionStopLoss } : undefined;
  const hasSl = positionHasStopLoss(posRow);

  if (openEntries && hasPosition) {
    issues.push({
      kind: 'entry_db_stale',
      message:
        'В БД вход помечен как открытый (Untriggered/New), но на бирже позиция уже есть — статус мог не синхронизироваться',
    });
  }

  if (!hasPosition) {
    return issues;
  }

  if (slConfigured && !hasSl) {
    issues.push({
      kind: 'missing_sl',
      message: 'Позиция открыта, stop loss на бирже не установлен',
    });
  }

  if (needsTp && !liveTp && !openEntries) {
    issues.push({
      kind: 'missing_tp',
      message: 'Позиция открыта, активных TP-ордеров в учёте нет',
    });
  }

  return issues;
}

export function buildStuckSummary(issues: StuckTradeIssue[]): string {
  if (issues.length === 0) {
    return '';
  }
  return issues.map((i) => stuckIssueLabel(i.kind)).join(' · ');
}

export function readPositionSizeAndSl(
  rows: Array<{ size?: string; side?: string; stopLoss?: string; takeProfit?: string }>,
  direction: 'long' | 'short',
): { size: number; stopLoss?: string; takeProfit?: string } {
  const row = pickPositionRowForSignalDirection(rows, direction);
  const size = row?.size ? Math.abs(parseFloat(String(row.size))) : 0;
  return {
    size: Number.isFinite(size) ? size : 0,
    stopLoss: row?.stopLoss,
    takeProfit: row?.takeProfit,
  };
}
