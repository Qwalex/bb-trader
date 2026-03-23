import { PnlChart } from './components/PnlChart';
import { LiveExposurePanel } from './components/LiveExposurePanel';

import { fetchJson } from '../lib/api';

type Stats = {
  winrate: number;
  wins: number;
  losses: number;
  totalClosed: number;
  totalPnl: number;
  openSignals: number;
};

type PnlPoint = { date: string; pnl: number };

export default async function Home() {
  let stats: Stats | null = null;
  let pnl: PnlPoint[] = [];
  let err: string | null = null;
  try {
    [stats, pnl] = await Promise.all([
      fetchJson<Stats>('/orders/stats'),
      fetchJson<PnlPoint[]>('/orders/pnl-series?bucket=day'),
    ]);
  } catch (e) {
    err = e instanceof Error ? e.message : 'Ошибка API';
  }

  return (
    <>
      <h1 className="pageTitle">Дашборд</h1>
      {err && (
        <p className="msg err" style={{ marginBottom: '1rem' }}>
          {err} — проверьте, что API запущен и NEXT_PUBLIC_API_URL верный.
        </p>
      )}
      {stats && (
        <div className="grid">
          <div className="card">
            <h3>Winrate</h3>
            <div className="value">{stats.winrate.toFixed(1)}%</div>
          </div>
          <div className="card">
            <h3>Всего PnL</h3>
            <div className="value">{stats.totalPnl.toFixed(2)}</div>
          </div>
          <div className="card">
            <h3>Закрыто</h3>
            <div className="value">{stats.totalClosed}</div>
          </div>
          <div className="card">
            <h3>W / L</h3>
            <div className="value">
              {stats.wins} / {stats.losses}
            </div>
          </div>
          <div className="card">
            <h3>Открытые сигналы</h3>
            <div className="value">{stats.openSignals}</div>
          </div>
        </div>
      )}
      <LiveExposurePanel />
      <h2 className="pageTitle" style={{ fontSize: '1.1rem' }}>
        PnL по дням
      </h2>
      <div className="chartWrap">
        <PnlChart data={pnl} />
      </div>
    </>
  );
}
