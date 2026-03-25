import Link from 'next/link';

import { fetchJson } from '../../lib/api';
import { DeleteTradeButton } from './delete-trade-button';
import { RecalcClosedPnlButton } from './recalc-closed-pnl-button';

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
  const page = typeof sp.page === 'string' ? sp.page : '1';
  if (source) q.set('source', source);
  if (pair) q.set('pair', pair);
  if (status) q.set('status', status);
  q.set('page', page);

  let data: TradesRes | null = null;
  let err: string | null = null;
  try {
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
                  <tr key={s.id}>
                    <td>{s.pair}</td>
                    <td>{s.direction}</td>
                    <td>{s.status}</td>
                    <td>{s.source ?? '—'}</td>
                    <td>
                      {s.realizedPnl !== null && s.realizedPnl !== undefined
                        ? s.realizedPnl.toFixed(4)
                        : '—'}
                    </td>
                    <td>{new Date(s.createdAt).toLocaleString('ru-RU')}</td>
                    <td>
                      <DeleteTradeButton
                        tradeId={s.id}
                        pair={s.pair}
                        status={s.status}
                      />
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
