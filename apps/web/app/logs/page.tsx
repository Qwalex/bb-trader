'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';

type LogRow = {
  id: string;
  level: string;
  category: string;
  message: string;
  payload: string | null;
  createdAt: string;
};

type TpSyncFilterMode = 'all' | 'hide' | 'only';

const CATEGORIES = [
  { id: 'all', label: 'Все' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'bybit', label: 'Bybit' },
  { id: 'orders', label: 'Orders' },
  { id: 'system', label: 'System' },
] as const;

const TP_SYNC_MESSAGE = 'tp: ордера синхронизированы';

function isTpSyncEvent(message: string): boolean {
  return message.trim().toLowerCase().includes(TP_SYNC_MESSAGE);
}

export default function LogsPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [limit, setLimit] = useState(300);
  const [tpSyncFilter, setTpSyncFilter] = useState<TpSyncFilterMode>('hide');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set('limit', String(limit));
      if (category !== 'all') q.set('category', category);
      const res = await fetch(`${getApiBase()}/logs?${q.toString()}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = (await res.json()) as LogRow[];
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [category, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function formatPayload(payload: string | null): string {
    if (!payload) return '';
    try {
      const parsed = JSON.parse(payload) as unknown;
      return JSON.stringify(parsed, null, 2);
    } catch {
      return payload;
    }
  }

  const tpSyncCount = useMemo(() => rows.filter((row) => isTpSyncEvent(row.message)).length, [rows]);
  const visibleRows = useMemo(() => {
    if (tpSyncFilter === 'all') return rows;
    if (tpSyncFilter === 'hide') return rows.filter((row) => !isTpSyncEvent(row.message));
    return rows.filter((row) => isTpSyncEvent(row.message));
  }, [rows, tpSyncFilter]);

  return (
    <div>
      <h1 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Логи</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Ключевые этапы сервиса и полные запросы/ответы OpenRouter (без API-ключа в теле; ключ
        только в заголовке Authorization на стороне сервера).
      </p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
          marginBottom: '1rem',
        }}
      >
        <label>
          Категория:{' '}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={{
              marginLeft: 4,
              padding: '0.35rem 0.5rem',
              background: 'var(--card)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Лимит:{' '}
          <input
            type="number"
            min={50}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(parseInt(e.target.value, 10) || 200)}
            style={{
              width: 80,
              marginLeft: 4,
              padding: '0.35rem 0.5rem',
              background: 'var(--card)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          />
        </label>
        <label>
          TP-синхронизация:{' '}
          <select
            value={tpSyncFilter}
            onChange={(e) => setTpSyncFilter(e.target.value as TpSyncFilterMode)}
            style={{
              marginLeft: 4,
              padding: '0.35rem 0.5rem',
              background: 'var(--card)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            <option value="hide">Скрыть «TP: ордера синхронизированы»</option>
            <option value="all">Показать все</option>
            <option value="only">Только «TP: ордера синхронизированы»</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          style={{
            padding: '0.4rem 0.9rem',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Обновить
        </button>
      </div>
      <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.8rem' }}>
        Событий «TP: ордера синхронизированы» в текущей выборке: {tpSyncCount}
      </p>

      {loading && <p style={{ color: 'var(--muted)' }}>Загрузка…</p>}
      {error && (
        <p style={{ color: '#f87171' }} role="alert">
          {error}
        </p>
      )}

      {!loading && !error && visibleRows.length === 0 && (
        <p style={{ color: 'var(--muted)' }}>
          {rows.length === 0
            ? 'Записей пока нет.'
            : 'Нет записей для текущего фильтра TP-синхронизации.'}
        </p>
      )}

      <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        {visibleRows.map((row) => (
          <li
            key={row.id}
            className="card"
            style={{ padding: '0.75rem 1rem', fontSize: '0.85rem' }}
          >
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                alignItems: 'baseline',
                marginBottom: 4,
              }}
            >
              <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
                {new Date(row.createdAt).toLocaleString('ru-RU')}
              </span>
              <span
                style={{
                  padding: '0.1rem 0.4rem',
                  borderRadius: 4,
                  background:
                    row.level === 'error'
                      ? '#7f1d1d'
                      : row.level === 'warn'
                        ? '#713f12'
                        : '#1e3a5f',
                  fontSize: '0.7rem',
                  textTransform: 'uppercase',
                }}
              >
                {row.level}
              </span>
              <span style={{ color: 'var(--accent)' }}>{row.category}</span>
              <strong>{row.message}</strong>
            </div>
            {row.payload && (
              <div>
                <button
                  type="button"
                  onClick={() => toggle(row.id)}
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--accent)',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {expanded[row.id] ? '▼ Скрыть payload' : '▶ Показать payload'}
                </button>
                {expanded[row.id] && (
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.75rem',
                      overflow: 'auto',
                      maxHeight: 'min(70vh, 600px)',
                      background: '#0a0e14',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      fontSize: '0.75rem',
                      lineHeight: 1.45,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {formatPayload(row.payload)}
                  </pre>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
