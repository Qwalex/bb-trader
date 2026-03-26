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
type UserbotStatus = {
  balanceGuard?: {
    minBalanceUsd: number;
    balanceUsd: number | null;
    paused: boolean;
    reason?: string;
  };
};

export default async function Home() {
  let stats: Stats | null = null;
  let pnl: PnlPoint[] = [];
  let userbotStatus: UserbotStatus | null = null;
  let err: string | null = null;
  try {
    [stats, pnl] = await Promise.all([
      fetchJson<Stats>('/orders/stats'),
      fetchJson<PnlPoint[]>('/orders/pnl-series?bucket=day'),
    ]);
  } catch (e) {
    err = e instanceof Error ? e.message : 'Ошибка API';
  }
  try {
    userbotStatus = await fetchJson<UserbotStatus>('/telegram-userbot/status');
  } catch {
    // Userbot status is optional for dashboard render.
  }
  const guard = userbotStatus?.balanceGuard;

  return (
    <>
      <h1 className="pageTitle">Дашборд</h1>
      {err && (
        <p className="msg err" style={{ marginBottom: '1rem' }}>
          {err} — проверьте, что API запущен и NEXT_PUBLIC_API_URL верный.
        </p>
      )}
      {guard?.paused && (
        <p className="msg err" style={{ marginBottom: '1rem' }}>
          {guard.reason ??
            `Автоматическая установка ордеров приостановлена: баланс ниже допустимого порога ${guard.minBalanceUsd.toFixed(2)}$`}
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
          <div className="card">
            <h3>Баланс USDT</h3>
            <div className="value">
              {guard?.balanceUsd != null ? `${guard.balanceUsd.toFixed(2)}$` : '—'}
            </div>
            <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
              Порог автоторговли: {(guard?.minBalanceUsd ?? 3).toFixed(2)}$
            </p>
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
