import { PnlChart } from './components/PnlChart';
import { LiveExposurePanel } from './components/LiveExposurePanel';

import Link from 'next/link';

import { fetchJson } from '../lib/api';

type Stats = {
  source?: string | null;
  winrate: number;
  wins: number;
  losses: number;
  totalClosed: number;
  totalPnl: number;
  openSignals: number;
};

type PnlPoint = { date: string; pnl: number };
type SourceStatsItem = {
  source: string | null;
  winrate: number;
  wins: number;
  losses: number;
  wL: string;
  totalClosed: number;
  openSignals: number;
  totalPnl: number;
};
type TopSources = {
  byPnl: SourceStatsItem[];
  byWinrate: SourceStatsItem[];
  byWorstPnl: SourceStatsItem[];
  byWorstWinrate: SourceStatsItem[];
  worstWinrate: SourceStatsItem | null;
};
type SettingsRaw = {
  settings: { key: string; value: string }[];
};
type UserbotStatus = {
  balanceGuard?: {
    minBalanceUsd: number;
    balanceUsd: number | null;
    paused: boolean;
    reason?: string;
  };
};

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const source = typeof sp.source === 'string' ? sp.source.trim() : '';
  let stats: Stats | null = null;
  let pnl: PnlPoint[] = [];
  let top: TopSources | null = null;
  let sourceOptions: string[] = [];
  let userbotStatus: UserbotStatus | null = null;
  let err: string | null = null;
  try {
    const q = new URLSearchParams();
    if (source) q.set('source', source);
    const qs = q.toString();
    [stats, pnl, top, sourceOptions] = await Promise.all([
      fetchJson<Stats>(`/orders/stats${qs ? `?${qs}` : ''}`),
      fetchJson<PnlPoint[]>(`/orders/pnl-series?bucket=day${source ? `&source=${encodeURIComponent(source)}` : ''}`),
      fetchJson<TopSources>('/orders/top-sources?limit=5'),
      (async () => {
        try {
          const [sourcesFromDb, settingsRaw] = await Promise.all([
            fetchJson<string[]>('/orders/sources'),
            fetchJson<SettingsRaw>('/settings/raw'),
          ]);
          const raw = settingsRaw.settings.find((r) => r.key === 'SOURCE_LIST')?.value;
          const rawExcluded = settingsRaw.settings.find((r) => r.key === 'SOURCE_EXCLUDE_LIST')
            ?.value;
          let sourcesFromSettings: string[] = [];
          let excludedSources: string[] = [];
          if (raw && raw.trim()) {
            try {
              const parsed = JSON.parse(raw) as unknown;
              if (Array.isArray(parsed)) {
                sourcesFromSettings = parsed
                  .map((v) => (typeof v === 'string' ? v.trim() : ''))
                  .filter((v) => v.length > 0);
              }
            } catch {
              // ignore malformed SOURCE_LIST
            }
          }
          if (rawExcluded && rawExcluded.trim()) {
            try {
              const parsed = JSON.parse(rawExcluded) as unknown;
              if (Array.isArray(parsed)) {
                excludedSources = parsed
                  .map((v) => (typeof v === 'string' ? v.trim() : ''))
                  .filter((v) => v.length > 0);
              }
            } catch {
              // ignore malformed SOURCE_EXCLUDE_LIST
            }
          }
          const excludedSet = new Set(excludedSources);
          return Array.from(new Set([...sourcesFromDb, ...sourcesFromSettings])).sort((a, b) =>
            a.localeCompare(b, 'ru'),
          ).filter((s) => !excludedSet.has(s));
        } catch {
          return [];
        }
      })(),
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
      <form className="filters" method="get" action="/trade">
        <label>
          Источник
          <select
            name="source"
            defaultValue={source}
          >
            <option value="">все</option>
            {sourceOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          style={{
            padding: '0.45rem 0.9rem',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Показать
        </button>
        {source && (
          <Link
            href="/"
            style={{
              alignSelf: 'end',
              padding: '0.45rem 0.9rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--foreground)',
              textDecoration: 'none',
            }}
          >
            Сброс
          </Link>
        )}
      </form>
      {stats && (
        <div className="grid">
          <div className="card">
            <h3>Winrate{source ? ' (источник)' : ''}</h3>
            <div className="value">{stats.winrate.toFixed(1)}%</div>
          </div>
          {top?.worstWinrate && (
            <div className="card">
              <h3>Худший winrate</h3>
              <div className="value">{top.worstWinrate.winrate.toFixed(1)}%</div>
              <p style={{ color: 'var(--muted)', marginTop: '0.35rem', fontSize: '0.8rem' }}>
                {top.worstWinrate.source ?? '—'} | W/L: {top.worstWinrate.wL}
              </p>
            </div>
          )}
          <div className="card">
            <h3>Всего PnL{source ? ' (источник)' : ''}</h3>
            <div className="value">{stats.totalPnl.toFixed(2)}</div>
          </div>
          <div className="card">
            <h3>Закрыто{source ? ' (источник)' : ''}</h3>
            <div className="value">{stats.totalClosed}</div>
          </div>
          <div className="card">
            <h3>W / L</h3>
            <div className="value">
              {stats.wins} / {stats.losses}
            </div>
          </div>
          <div className="card">
            <h3>Открытые сигналы{source ? ' (источник)' : ''}</h3>
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
      {top && (
        <div className="grid topSources" style={{ marginTop: '1rem' }}>
          <div className="card" style={{ gridColumn: 'span 5' }}>
            <h3>Топ источников по PnL</h3>
            <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
              <table className="topSourcesTable">
                <thead>
                  <tr>
                    <th className="sourceNameCell">Источник</th>
                    <th>PnL</th>
                    <th>Winrate</th>
                    <th>W / L</th>
                    <th>Закрыто</th>
                    <th>Открыто</th>
                  </tr>
                </thead>
                <tbody>
                  {top.byPnl.map((r) => (
                    <tr key={`pnl-${r.source ?? '—'}`}>
                      <td className="sourceNameCell">
                        <span className="sourceNameText">{r.source ?? '—'}</span>
                      </td>
                      <td>{r.totalPnl.toFixed(2)}</td>
                      <td>{r.winrate.toFixed(1)}%</td>
                      <td>{r.wL}</td>
                      <td>{r.totalClosed}</td>
                      <td>{r.openSignals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ gridColumn: 'span 5' }}>
            <h3>Топ источников по Winrate</h3>
            <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
              <table className="topSourcesTable">
                <thead>
                  <tr>
                    <th className="sourceNameCell">Источник</th>
                    <th>Winrate</th>
                    <th>W / L</th>
                    <th>PnL</th>
                    <th>Закрыто</th>
                    <th>Открыто</th>
                  </tr>
                </thead>
                <tbody>
                  {top.byWinrate.map((r) => (
                    <tr key={`wr-${r.source ?? '—'}`}>
                      <td className="sourceNameCell">
                        <span className="sourceNameText">{r.source ?? '—'}</span>
                      </td>
                      <td>{r.winrate.toFixed(1)}%</td>
                      <td>{r.wL}</td>
                      <td>{r.totalPnl.toFixed(2)}</td>
                      <td>{r.totalClosed}</td>
                      <td>{r.openSignals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ gridColumn: 'span 5' }}>
            <h3>Топ источников по худшему PnL</h3>
            <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
              <table className="topSourcesTable">
                <thead>
                  <tr>
                    <th className="sourceNameCell">Источник</th>
                    <th>PnL</th>
                    <th>Winrate</th>
                    <th>W / L</th>
                    <th>Закрыто</th>
                    <th>Открыто</th>
                  </tr>
                </thead>
                <tbody>
                  {top.byWorstPnl.map((r) => (
                    <tr key={`worst-pnl-${r.source ?? '—'}`}>
                      <td className="sourceNameCell">
                        <span className="sourceNameText">{r.source ?? '—'}</span>
                      </td>
                      <td>{r.totalPnl.toFixed(2)}</td>
                      <td>{r.winrate.toFixed(1)}%</td>
                      <td>{r.wL}</td>
                      <td>{r.totalClosed}</td>
                      <td>{r.openSignals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card" style={{ gridColumn: 'span 5' }}>
            <h3>Топ источников по худшему Winrate</h3>
            <div className="tableWrap" style={{ marginTop: '0.5rem' }}>
              <table className="topSourcesTable">
                <thead>
                  <tr>
                    <th className="sourceNameCell">Источник</th>
                    <th>Winrate</th>
                    <th>W / L</th>
                    <th>PnL</th>
                    <th>Закрыто</th>
                    <th>Открыто</th>
                  </tr>
                </thead>
                <tbody>
                  {top.byWorstWinrate.map((r) => (
                    <tr key={`worst-wr-${r.source ?? '—'}`}>
                      <td className="sourceNameCell">
                        <span className="sourceNameText">{r.source ?? '—'}</span>
                      </td>
                      <td>{r.winrate.toFixed(1)}%</td>
                      <td>{r.wL}</td>
                      <td>{r.totalPnl.toFixed(2)}</td>
                      <td>{r.totalClosed}</td>
                      <td>{r.openSignals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      <h2 className="pageTitle" style={{ fontSize: '1.1rem' }}>
        PnL по дням{source ? ` — ${source}` : ''}
      </h2>
      <div className="chartWrap">
        <PnlChart data={pnl} />
      </div>
      <LiveExposurePanel />
    </>
  );
}
