'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';
import { formatDateTimeRu } from '../../lib/datetime';

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
  const [jsonLoadingId, setJsonLoadingId] = useState<string | null>(null);
  const [jsonBySignalId, setJsonBySignalId] = useState<Record<string, string>>({});
  const [expandedBySignalId, setExpandedBySignalId] = useState<Record<string, boolean>>({});
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

  const loadSignalJson = useCallback(
    async (signalId: string) => {
      setJsonLoadingId(signalId);
      setError(null);
      try {
        const res = await fetch(`${apiBase}/bybit/signal/${signalId}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText}`);
        }
        const body = (await res.json()) as unknown;
        setJsonBySignalId((prev) => ({
          ...prev,
          [signalId]: JSON.stringify(body, null, 2),
        }));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка загрузки JSON');
      } finally {
        setJsonLoadingId(null);
      }
    },
    [apiBase],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const toggleExpanded = useCallback((signalId: string) => {
    setExpandedBySignalId((prev) => ({ ...prev, [signalId]: !prev[signalId] }));
  }, []);

  return (
    <section style={{ marginBottom: '2rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.5rem',
        }}
      >
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
          {(() => {
            const isExpanded = Boolean(expandedBySignalId[item.signalId]);
            const activeOrdersCount = item.exchange.activeOrders.length;
            const positionsCount = item.exchange.positions.length;
            return (
              <>
                <button
                  type="button"
                  onClick={() => toggleExpanded(item.signalId)}
                  className="liveExposureHeaderButton"
                  aria-expanded={isExpanded}
                  aria-controls={`live-exposure-${item.signalId}`}
                >
                  <div>
                    <strong>{item.pair}</strong> · {item.direction} · {item.status}
                    <div style={{ color: 'var(--muted)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                      Источник: {item.source ?? '—'} · {formatDateTimeRu(item.createdAt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span className="liveExposureSummaryBadge">
                      Ордера: {activeOrdersCount} · Позиции: {positionsCount}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
                      {isExpanded ? 'Скрыть' : 'Подробнее'}
                    </span>
                  </div>
                </button>

                {isExpanded && (
                  <div id={`live-exposure-${item.signalId}`}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        alignItems: 'center',
                        marginBottom: '0.6rem',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void loadSignalJson(item.signalId)}
                        disabled={jsonLoadingId === item.signalId}
                        style={{
                          padding: '0.45rem 0.9rem',
                          background: 'var(--card)',
                          color: 'var(--text)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          cursor: 'pointer',
                        }}
                      >
                        {jsonLoadingId === item.signalId ? 'Загрузка JSON...' : 'JSON'}
                      </button>
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

                    {jsonBySignalId[item.signalId] && (
                      <div style={{ marginTop: '0.6rem' }}>
                        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '0.35rem' }}>
                          JSON-снимок (БД + биржа)
                        </div>
                        <pre
                          style={{
                            margin: 0,
                            padding: '0.75rem',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: '#0f172a',
                            color: '#e2e8f0',
                            overflowX: 'auto',
                            whiteSpace: 'pre',
                            fontSize: '0.78rem',
                            lineHeight: 1.4,
                          }}
                        >
                          {jsonBySignalId[item.signalId]}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      ))}
    </section>
  );
}
