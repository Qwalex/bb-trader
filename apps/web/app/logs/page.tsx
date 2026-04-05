'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { getApiBase } from '../../lib/api';
import { formatDateTimeRu } from '../../lib/datetime';

type LogRow = {
  id: string;
  level: string;
  category: string;
  message: string;
  payload: string | null;
  createdAt: string;
};

type TpLogFilterMode = 'all' | 'hide' | 'only';
type NoiseLogFilterMode = 'all' | 'hide' | 'only';
type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'plain';
type JsonToken = { text: string; kind: JsonTokenKind };

const CATEGORIES = [
  { id: 'all', label: 'Все' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'telegram', label: 'Telegram' },
  { id: 'vk', label: 'VK' },
  { id: 'bybit', label: 'Bybit' },
  { id: 'orders', label: 'Orders' },
  { id: 'system', label: 'System' },
] as const;

function isTpLogEvent(message: string): boolean {
  const msg = message.trim().toLowerCase();
  return msg.includes('placetpsplit') || msg.includes('tp:');
}

function isNoiseLogEvent(message: string): boolean {
  const msg = message.trim();
  return (
    msg === 'poll: stale signal kept because exchange exposure still exists' ||
    msg === 'poll: reconcile stale pass started' ||
    msg === 'Userbot: duplicate ingest skipped'
  );
}

function tokenizeJson(pretty: string): JsonToken[] {
  const tokenRegex =
    /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}\[\],:]/g;
  const out: JsonToken[] = [];
  let last = 0;
  for (const match of pretty.matchAll(tokenRegex)) {
    const index = match.index ?? 0;
    const token = match[0] ?? '';
    if (index > last) {
      out.push({ text: pretty.slice(last, index), kind: 'plain' });
    }
    let kind: JsonTokenKind = 'plain';
    if (/^"(?:\\.|[^"\\])*"$/.test(token) && pretty.slice(index + token.length).match(/^\s*:/)) {
      kind = 'key';
    } else if (/^"(?:\\.|[^"\\])*"$/.test(token)) {
      kind = 'string';
    } else if (/^-?\d/.test(token)) {
      kind = 'number';
    } else if (token === 'true' || token === 'false') {
      kind = 'boolean';
    } else if (token === 'null') {
      kind = 'null';
    } else if (/^[{}\[\],:]$/.test(token)) {
      kind = 'punct';
    }
    out.push({ text: token, kind });
    last = index + token.length;
  }
  if (last < pretty.length) {
    out.push({ text: pretty.slice(last), kind: 'plain' });
  }
  return out;
}

function formatPayloadPretty(payload: string | null): string {
  if (!payload) return '';
  try {
    const parsed = JSON.parse(payload) as unknown;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return payload;
  }
}

export default function LogsPage() {
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<string>('all');
  const [limit, setLimit] = useState(300);
  const [tpLogFilter, setTpLogFilter] = useState<TpLogFilterMode>('hide');
  const [noiseLogFilter, setNoiseLogFilter] = useState<NoiseLogFilterMode>('hide');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

  async function copyPayload(id: string, payload: string | null) {
    const pretty = formatPayloadPretty(payload);
    if (!pretty) return;
    try {
      await navigator.clipboard.writeText(pretty);
      setCopiedId(id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1200);
    } catch {
      // ignore clipboard errors
    }
  }

  const tpLogCount = useMemo(
    () => rows.filter((row) => isTpLogEvent(row.message)).length,
    [rows],
  );
  const noiseLogCount = useMemo(
    () => rows.filter((row) => isNoiseLogEvent(row.message)).length,
    [rows],
  );
  const visibleRows = useMemo(() => {
    let next = rows;
    if (tpLogFilter === 'hide') {
      next = next.filter((row) => !isTpLogEvent(row.message));
    } else if (tpLogFilter === 'only') {
      next = next.filter((row) => isTpLogEvent(row.message));
    }

    if (noiseLogFilter === 'hide') {
      next = next.filter((row) => !isNoiseLogEvent(row.message));
    } else if (noiseLogFilter === 'only') {
      next = next.filter((row) => isNoiseLogEvent(row.message));
    }

    return next;
  }, [rows, tpLogFilter, noiseLogFilter]);

  return (
    <div>
      <h1 style={{ marginBottom: '1rem', fontSize: '1.5rem' }}>Логи</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>
        Ключевые этапы сервиса и полные запросы/ответы OpenRouter (без API-ключа в теле; ключ
        только в заголовке Authorization на стороне сервера).
      </p>

      <div className="filters" style={{ marginBottom: '1rem' }}>
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
          TP-логи:{' '}
          <select
            value={tpLogFilter}
            onChange={(e) => setTpLogFilter(e.target.value as TpLogFilterMode)}
            style={{
              marginLeft: 4,
              padding: '0.35rem 0.5rem',
              background: 'var(--card)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            <option value="hide">Скрыть TP/placeTpSplit</option>
            <option value="all">Показать все</option>
            <option value="only">Только TP/placeTpSplit</option>
          </select>
        </label>
        <label>
          Шумные логи:{' '}
          <select
            value={noiseLogFilter}
            onChange={(e) => setNoiseLogFilter(e.target.value as NoiseLogFilterMode)}
            style={{
              marginLeft: 4,
              padding: '0.35rem 0.5rem',
              background: 'var(--card)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
              borderRadius: 6,
            }}
          >
            <option value="hide">Скрыть шумные</option>
            <option value="all">Показать все</option>
            <option value="only">Только шумные</option>
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
        TP/placeTpSplit событий в текущей выборке: {tpLogCount}
      </p>
      <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.8rem' }}>
        Шумных событий в текущей выборке: {noiseLogCount}
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
            : 'Нет записей для текущих фильтров.'}
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
                {formatDateTimeRu(row.createdAt)}
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
                    {tokenizeJson(formatPayloadPretty(row.payload)).map((token, idx) => (
                      <span
                        key={`${row.id}-tok-${idx}`}
                        className={`jsonTok jsonTok-${token.kind}`}
                      >
                        {token.text}
                      </span>
                    ))}
                  </pre>
                )}
                {expanded[row.id] && (
                  <button
                    type="button"
                    onClick={() => void copyPayload(row.id, row.payload)}
                    className="btn btnSecondary btnSm"
                    style={{ marginTop: '0.45rem' }}
                  >
                    {copiedId === row.id ? 'Скопировано' : 'Копировать'}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
