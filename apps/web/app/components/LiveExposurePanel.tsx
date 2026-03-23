'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';

type LiveExposureOrder = {
  orderId: string;
  side: string;
  type: string;
  status: string;
  price: number | null;
  qty: number | null;
  reduceOnly: boolean;
};

type LiveExposurePosition = {
  side: string;
  size: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  positionIdx: number;
};

type LiveExposureItem = {
  signalId: string;
  pair: string;
  direction: string;
  status: string;
  source: string | null;
  createdAt: string;
  dbOrders: {
    id: string;
    orderKind: string;
    side: string;
    status: string | null;
    price: number | null;
    qty: number | null;
    bybitOrderId: string | null;
  }[];
  exchange: {
    activeOrders: LiveExposureOrder[];
    positions: LiveExposurePosition[];
    hasExposure: boolean;
  };
};

type LiveExposureRes = {
  bybitConnected: boolean;
  items: LiveExposureItem[];
};

export function LiveExposurePanel() {
  const [data, setData] = useState<LiveExposureRes | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [lastMsg, setLastMsg] = useState<string | null>(null);

  const apiBase = useMemo(() => getApiBase(), []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/bybit/live`, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
      const json = (await res.json()) as LiveExposureRes;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const closeSignal = useCallback(
    async (signalId: string, pair: string) => {
      if (!confirm(`Закрыть сигнал ${pair} на бирже и в БД?`)) {
        return;
      }
      setClosingId(signalId);
      setLastMsg(null);
      try {
        const res = await fetch(`${apiBase}/bybit/close/${signalId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const body = (await res.json()) as {
          ok: boolean;
          error?: string;
          details?: string;
          cancelledOrders?: number;
          closedPositions?: number;
        };
        if (!res.ok || !body.ok) {
          throw new Error(body.details ?? body.error ?? `${res.status} ${res.statusText}`);
        }
        setLastMsg(
          `Сигнал закрыт: отменено ордеров ${body.cancelledOrders ?? 0}, закрыто позиций ${body.closedPositions ?? 0}.`,
        );
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка закрытия');
      } finally {
        setClosingId(null);
      }
    },
    [apiBase, load],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 className="pageTitle" style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>
          Текущие ордера и позиции
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          style={{
            padding: '0.45rem 0.9rem',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          {loading ? 'Обновление...' : 'Обновить'}
        </button>
      </div>

      {error && (
        <p className="msg err" style={{ marginBottom: '0.75rem' }}>
          {error}
        </p>
      )}
      {lastMsg && (
        <p className="msg ok" style={{ marginBottom: '0.75rem' }}>
          {lastMsg}
        </p>
      )}
      {data && !data.bybitConnected && (
        <p className="msg err" style={{ marginBottom: '0.75rem' }}>
          Bybit не подключён: нет API-ключей.
        </p>
      )}
      {data && data.items.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>Нет активных сигналов.</p>
      )}

      {data?.items.map((item) => (
        <div className="card" key={item.signalId} style={{ marginBottom: '0.75rem' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '0.6rem',
              gap: '0.75rem',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <strong>{item.pair}</strong> · {item.direction} · {item.status}
              <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                Источник: {item.source ?? '—'} · {new Date(item.createdAt).toLocaleString('ru-RU')}
              </div>
            </div>
            <button
              type="button"
              className="btnDanger"
              disabled={closingId === item.signalId}
              onClick={() => void closeSignal(item.signalId, item.pair)}
            >
              {closingId === item.signalId ? 'Закрытие...' : 'Закрыть сигнал'}
            </button>
          </div>

          <div className="tableWrap" style={{ marginBottom: '0.6rem' }}>
            <table>
              <thead>
                <tr>
                  <th colSpan={6}>Ордера на Bybit</th>
                </tr>
                <tr>
                  <th>ID</th>
                  <th>Сторона</th>
                  <th>Тип</th>
                  <th>Статус</th>
                  <th>Цена</th>
                  <th>Qty</th>
                </tr>
              </thead>
              <tbody>
                {item.exchange.activeOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--muted)' }}>
                      Нет активных ордеров
                    </td>
                  </tr>
                ) : (
                  item.exchange.activeOrders.map((o) => (
                    <tr key={o.orderId}>
                      <td>{o.orderId}</td>
                      <td>{o.side}</td>
                      <td>{o.type}</td>
                      <td>{o.status}</td>
                      <td>{o.price ?? '—'}</td>
                      <td>{o.qty ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th colSpan={5}>Позиции на Bybit</th>
                </tr>
                <tr>
                  <th>Сторона</th>
                  <th>Размер</th>
                  <th>Entry</th>
                  <th>Mark</th>
                  <th>uPnL</th>
                </tr>
              </thead>
              <tbody>
                {item.exchange.positions.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--muted)' }}>
                      Нет открытых позиций
                    </td>
                  </tr>
                ) : (
                  item.exchange.positions.map((p) => (
                    <tr key={`${item.signalId}-${p.positionIdx}`}>
                      <td>{p.side}</td>
                      <td>{p.size}</td>
                      <td>{p.entryPrice ?? '—'}</td>
                      <td>{p.markPrice ?? '—'}</td>
                      <td>{p.unrealizedPnl ?? '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
