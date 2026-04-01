'use client';

import { useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';

type Props = {
  signalId: string;
  status: string;
  realizedPnl: number | null;
};

type Breakdown = {
  ok: boolean;
  signalId: string;
  source: 'closed_pnl' | 'execution_fallback' | 'unavailable';
  finalPnl: number | null;
  grossPnl: number | null;
  fees: {
    openFee: number | null;
    closeFee: number | null;
    execFee: number | null;
    total: number | null;
  };
  details?: string;
  error?: string;
};

const breakdownCache = new Map<string, Breakdown>();

function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) {
    return '—';
  }
  return v.toFixed(4);
}

function getOutcomeLabel(status: string, pnl: number | null): string {
  if (status === 'CLOSED_WIN') return 'прибыль';
  if (status === 'CLOSED_LOSS') return 'убыток';
  if (status === 'CLOSED_MIXED') return 'смешанный результат';
  if (status === 'FAILED') return 'ошибка';
  if (status === 'ORDERS_PLACED' || status === 'OPEN' || status === 'PARSED') {
    return 'в работе';
  }
  if (typeof pnl === 'number' && Number.isFinite(pnl)) {
    if (pnl > 0) return 'прибыль';
    if (pnl < 0) return 'убыток';
  }
  return status.toLowerCase();
}

function buildTooltip(
  status: string,
  fallbackPnl: number | null,
  breakdown: Breakdown | null,
  loading: boolean,
): string {
  if (loading) {
    return 'Загружаю комиссии...';
  }

  if (!breakdown) {
    return [
      `Итог сделки: ${getOutcomeLabel(status, fallbackPnl)}`,
      `Финальный PnL: ${formatNumber(fallbackPnl)}`,
      'Наведите курсор ещё раз, чтобы подтянуть комиссии.',
    ].join('\n');
  }

  const finalPnl = breakdown.finalPnl ?? fallbackPnl;
  const rows = [
    `Итог сделки: ${getOutcomeLabel(status, finalPnl)}`,
    `Финальный PnL (net): ${formatNumber(finalPnl)}`,
    `PnL до комиссий (gross): ${formatNumber(breakdown.grossPnl)}`,
    `openFee: ${formatNumber(breakdown.fees.openFee)}`,
    `closeFee: ${formatNumber(breakdown.fees.closeFee)}`,
    `execFee: ${formatNumber(breakdown.fees.execFee)}`,
    `Всего комиссий: ${formatNumber(breakdown.fees.total)}`,
  ];

  if (breakdown.source === 'execution_fallback') {
    rows.push('Источник расчёта: execution fallback (open/close fee могут быть недоступны отдельно)');
  }
  if (breakdown.details) {
    rows.push(`Примечание: ${breakdown.details}`);
  }
  if (breakdown.error) {
    rows.push(`Ошибка: ${breakdown.error}`);
  }
  return rows.join('\n');
}

export function TradeFinalPnl({ signalId, status, realizedPnl }: Props) {
  const [loading, setLoading] = useState(false);
  const [breakdown, setBreakdown] = useState<Breakdown | null>(
    breakdownCache.get(signalId) ?? null,
  );

  const displayPnl = breakdown?.finalPnl ?? realizedPnl;
  const cls = useMemo(() => {
    const classes = ['pnl'];
    if (displayPnl === null || displayPnl === undefined || !Number.isFinite(displayPnl)) {
      return classes.join(' ');
    }
    if (displayPnl > 0) classes.push('pnlPos');
    else if (displayPnl < 0) classes.push('pnlNeg');
    else classes.push('pnlZero');
    return classes.join(' ');
  }, [displayPnl]);

  async function ensureBreakdown() {
    if (loading || breakdownCache.has(signalId)) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getApiBase()}/bybit/trade-pnl-breakdown/${signalId}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const data = (await res.json()) as Breakdown;
      breakdownCache.set(signalId, data);
      setBreakdown(data);
    } catch (e) {
      const errData: Breakdown = {
        ok: false,
        signalId,
        source: 'unavailable',
        finalPnl: realizedPnl,
        grossPnl: null,
        fees: {
          openFee: null,
          closeFee: null,
          execFee: null,
          total: null,
        },
        error: e instanceof Error ? e.message : 'Не удалось загрузить комиссии',
      };
      breakdownCache.set(signalId, errData);
      setBreakdown(errData);
    } finally {
      setLoading(false);
    }
  }

  return (
    <span
      className={cls}
      title={buildTooltip(status, realizedPnl, breakdown, loading)}
      onMouseEnter={() => void ensureBreakdown()}
      onFocus={() => void ensureBreakdown()}
    >
      {formatNumber(displayPnl)}
    </span>
  );
}
