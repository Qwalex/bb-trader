import Link from 'next/link';

import { fetchJson } from '../../lib/api';
import { DeleteTradeButton } from './delete-trade-button';
import { RecalcClosedPnlButton } from './recalc-closed-pnl-button';
import { RestoreTradeButton } from './restore-trade-button';
import { SourceSelect } from './source-select';

type Order = {
  id: string;
  orderKind: string;
  side: string;
  status: string;
  price: number | null;
  qty: number | null;
};

type Signal = {
  id: string;
  pair: string;
  direction: string;
  status: string;
  source: string | null;
  realizedPnl: number | null;
  createdAt: string;
  deletedAt?: string | null;
  orders: Order[];
};

type TradesRes = {
  items: Signal[];
  total: number;
  page: number;
  pageSize: number;
};

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  const source = typeof sp.source === 'string' ? sp.source : '';
  const pair = typeof sp.pair === 'string' ? sp.pair : '';
  const status = typeof sp.status === 'string' ? sp.status : '';
  const includeDeleted =
    typeof sp.includeDeleted === 'string'
      ? sp.includeDeleted === '1' || sp.includeDeleted === 'true'
      : false;
  const page = typeof sp.page === 'string' ? sp.page : '1';
  if (source) q.set('source', source);
  if (pair) q.set('pair', pair);
  if (status) q.set('status', status);
  if (includeDeleted) q.set('includeDeleted', '1');
  q.set('page', page);

  let data: TradesRes | null = null;
  let err: string | null = null;
  let sourceOptions: string[] = [];
  try {
    // 1) Список источников (нужно для dropdown и не должен ломать таблицу)
    try {
      const [sourcesFromDb, settingsRaw] = await Promise.all([
        fetchJson<string[]>(`/orders/sources`),
        fetchJson<{
          settings: { key: string; value: string }[];
        }>(`/settings/raw`),
      ]);

      const raw = settingsRaw.settings.find((r) => r.key === 'SOURCE_LIST')
        ?.value;

      let sourcesFromSettings: string[] = [];
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

      sourceOptions = Array.from(
        new Set([...sourcesFromDb, ...sourcesFromSettings]),
      ).sort((a, b) => a.localeCompare(b, 'ru'));
    } catch {
      sourceOptions = [];
    }

    // 2) Таблица сделок
    data = await fetchJson<TradesRes>(`/orders/trades?${q.toString()}`);
  } catch (e) {
    err = e instanceof Error ? e.message : 'Ошибка';
  }

  const buildPageLink = (p: number) => {
    const nq = new URLSearchParams(q);
    nq.set('page', String(p));
    return `/trades?${nq.toString()}`;
  };

  return (
    <>
      <h1 className="pageTitle">История сделок</h1>
      {err && <p className="msg err">{err}</p>}
      <form className="filters" method="get" action="/trades">
        <label>
          Источник
          <input
            name="source"
            defaultValue={source}
            placeholder="канал или приложение"
          />
        </label>
        <label>
          Пара
          <input name="pair" defaultValue={pair} placeholder="BTCUSDT" />
        </label>
        <label>
          Статус
          <select name="status" defaultValue={status}>
            <option value="">все</option>
            <option value="ORDERS_PLACED">ORDERS_PLACED</option>
            <option value="CLOSED_WIN">CLOSED_WIN</option>
            <option value="CLOSED_LOSS">CLOSED_LOSS</option>
            <option value="FAILED">FAILED</option>
          </select>
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            name="includeDeleted"
            value="1"
            defaultChecked={includeDeleted}
          />
          <span className="toggleTrack" aria-hidden="true">
            <span className="toggleThumb" />
          </span>
          <span className="toggleLabel">Показать удалённые</span>
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
          Фильтр
        </button>
      </form>
      <div style={{ marginBottom: '1rem' }}>
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
          Критично для статистики: пересчёт `realizedPnl` учитывает SL, даже если у него другой
          `orderId` (dry-run → затем запись в БД).
        </p>
        <RecalcClosedPnlButton limit={500} />
      </div>
      {data && (
        <>
          <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>
            Всего: {data.total} (стр. {data.page} из{' '}
            {Math.max(1, Math.ceil(data.total / data.pageSize))})
          </p>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Пара</th>
                  <th>Сторона</th>
                  <th>Статус</th>
                  <th>Источник</th>
                  <th>PnL</th>
                  <th>Дата</th>
                  <th>Действие</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} style={s.deletedAt ? { opacity: 0.6 } : undefined}>
                    <td>{s.pair}</td>
                    <td>{s.direction}</td>
                    <td>{s.status}</td>
                    <td style={{ minWidth: 220 }}>
                      {s.deletedAt ? (
                        <span style={{ color: 'var(--muted)' }}>{s.source ?? '—'}</span>
                      ) : (
                        <SourceSelect
                          signalId={s.id}
                          status={s.status}
                          currentSource={s.source}
                          options={sourceOptions}
                        />
                      )}
                    </td>
                    <td>
                      {s.realizedPnl !== null && s.realizedPnl !== undefined ? (
                        <span
                          className={[
                            'pnl',
                            s.realizedPnl > 0
                              ? 'pnlPos'
                              : s.realizedPnl < 0
                                ? 'pnlNeg'
                                : 'pnlZero',
                          ].join(' ')}
                          title={`PnL: ${s.realizedPnl}`}
                        >
                          {s.realizedPnl.toFixed(4)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{new Date(s.createdAt).toLocaleString('ru-RU')}</td>
                    <td>
                      {s.deletedAt ? (
                        <RestoreTradeButton tradeId={s.id} pair={s.pair} />
                      ) : (
                        <DeleteTradeButton
                          tradeId={s.id}
                          pair={s.pair}
                          status={s.status}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem' }}>
            {data.page > 1 && (
              <Link href={buildPageLink(data.page - 1)}>← Назад</Link>
            )}
            {data.page * data.pageSize < data.total && (
              <Link href={buildPageLink(data.page + 1)}>Вперёд →</Link>
            )}
          </div>
        </>
      )}
    </>
  );
}
