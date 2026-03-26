import Link from 'next/link';

import { fetchJson } from '../../lib/api';
import { RecalcClosedPnlButton } from './recalc-closed-pnl-button';
import { TradesList } from './trades-list';
import { TradesFilters } from './trades-filters';

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
  /** JSON number[] в БД */
  entries: string | number[];
  stopLoss: number;
  /** JSON number[] в БД */
  takeProfits: string | number[];
  leverage: number;
  /** Номинал в USDT */
  orderUsd: number;
  capitalPercent: number;
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
    return `?${nq.toString()}`;
  };

  return (
    <>
      <h1 className="pageTitle">История сделок</h1>
      {err && <p className="msg err">{err}</p>}
      <TradesFilters sourceOptions={sourceOptions} />
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
          <TradesList items={data.items} sourceOptions={sourceOptions} />
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
