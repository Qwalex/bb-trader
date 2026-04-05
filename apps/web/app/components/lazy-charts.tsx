'use client';

import dynamic from 'next/dynamic';

import type { BalancePoint } from './BalanceChart';

const BalanceChart = dynamic(
  () => import('./BalanceChart').then((m) => m.BalanceChart),
  { ssr: false },
);

const PnlChart = dynamic(
  () => import('./PnlChart').then((m) => m.PnlChart),
  { ssr: false },
);

export type DashboardPnlPoint = { date: string; pnl: number };

export function LazyBalanceChart({ data }: { data: BalancePoint[] }) {
  return (
    <div className="chartWrap">
      <BalanceChart data={data} />
    </div>
  );
}

export function LazyPnlChart({ data }: { data: DashboardPnlPoint[] }) {
  return (
    <div className="chartWrap">
      <PnlChart data={data} />
    </div>
  );
}
