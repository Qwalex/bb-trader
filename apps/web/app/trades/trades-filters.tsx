'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

type Props = {
  sourceOptions: string[];
};

function normalizePairInput(v: string): string {
  return v.replace(/\s+/g, '').toUpperCase();
}

function cleanString(v: string): string {
  return v.trim();
}

export function TradesFilters({ sourceOptions }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const initial = useMemo(() => {
    const signalId = cleanString(sp.get('signalId') ?? '');
    const source = cleanString(sp.get('source') ?? '');
    const pair = cleanString(sp.get('pair') ?? '');
    const status = cleanString(sp.get('status') ?? '');
    const includeDeleted = sp.get('includeDeleted') === '1' || sp.get('includeDeleted') === 'true';
    const sortBy: 'createdAt' | 'closedAt' =
      sp.get('sortBy') === 'closedAt' ? 'closedAt' : 'createdAt';
    const refreshPnl =
      sp.get('refreshPnl') === '1' || sp.get('refreshPnl')?.toLowerCase() === 'true';
    const martingaleSteps =
      sp.get('martingaleSteps') === '1' ||
      sp.get('martingaleSteps')?.toLowerCase() === 'true';
    return {
      signalId,
      source,
      pair,
      status,
      includeDeleted,
      sortBy,
      refreshPnl,
      martingaleSteps,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [signalId, setSignalId] = useState(initial.signalId);
  const [source, setSource] = useState(initial.source);
  const [pair, setPair] = useState(initial.pair);
  const [status, setStatus] = useState(initial.status);
  const [includeDeleted, setIncludeDeleted] = useState(initial.includeDeleted);
  const [sortBy, setSortBy] = useState<'createdAt' | 'closedAt'>(initial.sortBy);
  const [refreshPnl, setRefreshPnl] = useState(initial.refreshPnl);
  const [martingaleSteps, setMartingaleSteps] = useState(initial.martingaleSteps);

  const signalIdTimer = useRef<number | null>(null);
  const pairTimer = useRef<number | null>(null);

  function replaceQuery(next: {
    signalId?: string;
    source?: string;
    pair?: string;
    status?: string;
    includeDeleted?: boolean;
    sortBy?: 'createdAt' | 'closedAt';
    refreshPnl?: boolean;
    martingaleSteps?: boolean;
  }) {
    const q = new URLSearchParams(sp.toString());

    if (next.signalId !== undefined) {
      const v = cleanString(next.signalId);
      if (v) q.set('signalId', v);
      else q.delete('signalId');
      q.delete('page');
    }
    if (next.source !== undefined) {
      const v = cleanString(next.source);
      if (v) q.set('source', v);
      else q.delete('source');
      q.delete('page');
    }
    if (next.pair !== undefined) {
      const v = normalizePairInput(next.pair);
      if (v) q.set('pair', v);
      else q.delete('pair');
      q.delete('page');
    }
    if (next.status !== undefined) {
      const v = cleanString(next.status);
      if (v) q.set('status', v);
      else q.delete('status');
      q.delete('page');
    }
    if (next.includeDeleted !== undefined) {
      if (next.includeDeleted) q.set('includeDeleted', '1');
      else q.delete('includeDeleted');
      q.delete('page');
    }
    if (next.sortBy !== undefined) {
      if (next.sortBy === 'closedAt') q.set('sortBy', 'closedAt');
      else q.delete('sortBy');
      q.delete('page');
    }
    if (next.refreshPnl !== undefined) {
      if (next.refreshPnl) q.set('refreshPnl', '1');
      else q.delete('refreshPnl');
      q.delete('page');
    }
    if (next.martingaleSteps !== undefined) {
      if (next.martingaleSteps) q.set('martingaleSteps', '1');
      else q.delete('martingaleSteps');
      q.delete('page');
    }

    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  useEffect(() => {
    return () => {
      if (signalIdTimer.current) window.clearTimeout(signalIdTimer.current);
      if (pairTimer.current) window.clearTimeout(pairTimer.current);
    };
  }, []);

  return (
    <div className="filters">
      <label>
        ID сделки
        <input
          value={signalId}
          onChange={(e) => {
            const v = e.target.value;
            setSignalId(v);
            if (signalIdTimer.current) window.clearTimeout(signalIdTimer.current);
            signalIdTimer.current = window.setTimeout(() => {
              replaceQuery({ signalId: v });
            }, 250);
          }}
          placeholder="напр. cm9ab123 или полный cuid"
          inputMode="text"
          autoComplete="off"
        />
      </label>

      <label>
        Источник
        <select
          value={source}
          onChange={(e) => {
            const v = e.target.value;
            setSource(v);
            replaceQuery({ source: v });
          }}
        >
          <option value="">все</option>
          <option value="—">(без source)</option>
          {sourceOptions.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label>
        Пара
        <input
          value={pair}
          onChange={(e) => {
            const v = e.target.value;
            setPair(v);
            if (pairTimer.current) window.clearTimeout(pairTimer.current);
            pairTimer.current = window.setTimeout(() => {
              replaceQuery({ pair: v });
            }, 250);
          }}
          placeholder="BTC / BTCUSDT / ETH"
          inputMode="text"
          autoComplete="off"
        />
      </label>

      <label>
        Статус
        <select
          value={status}
          onChange={(e) => {
            const v = e.target.value;
            setStatus(v);
            replaceQuery({ status: v });
          }}
        >
          <option value="">все</option>
          <option value="ORDERS_PLACED">ORDERS_PLACED</option>
          <option value="CLOSED_WIN">CLOSED_WIN</option>
          <option value="CLOSED_LOSS">CLOSED_LOSS</option>
          <option value="CLOSED_MIXED">CLOSED_MIXED</option>
          <option value="FAILED">FAILED</option>
        </select>
      </label>

      <label className="toggle tradesFiltersToggle" title="Показать удаленные" style={{ justifyContent: 'flex-end' }}>
        <input
          type="checkbox"
          checked={includeDeleted}
          aria-label="Показать удаленные"
          onChange={(e) => {
            const v = e.target.checked;
            setIncludeDeleted(v);
            replaceQuery({ includeDeleted: v });
          }}
        />
        <span className="toggleTrack" aria-hidden="true">
          <span className="toggleThumb" />
        </span>
      </label>

      <label>
        Сортировка
        <select
          value={sortBy}
          onChange={(e) => {
            const v = e.target.value === 'closedAt' ? 'closedAt' : 'createdAt';
            setSortBy(v);
            replaceQuery({ sortBy: v });
          }}
        >
          <option value="createdAt">по дате создания</option>
          <option value="closedAt">по дате закрытия</option>
        </select>
      </label>

      <label
        className="toggle tradesFiltersToggle"
        title="По умолчанию PnL берётся из БД без запросов к Bybit"
        style={{ justifyContent: 'flex-end' }}
      >
        <input
          type="checkbox"
          checked={refreshPnl}
          aria-label="Детализация PnL с Bybit"
          onChange={(e) => {
            const v = e.target.checked;
            setRefreshPnl(v);
            replaceQuery({ refreshPnl: v });
          }}
        />
        <span className="toggleTrack" aria-hidden="true">
          <span className="toggleThumb" />
        </span>
        <span style={{ fontSize: '0.82rem', maxWidth: '11rem' }}>
          PnL с Bybit (медленно)
        </span>
      </label>

      <label
        className="toggle tradesFiltersToggle"
        title="Тяжёлый расчёт по всей истории источника"
        style={{ justifyContent: 'flex-end' }}
      >
        <input
          type="checkbox"
          checked={martingaleSteps}
          aria-label="Шаг мартингейла"
          onChange={(e) => {
            const v = e.target.checked;
            setMartingaleSteps(v);
            replaceQuery({ martingaleSteps: v });
          }}
        />
        <span className="toggleTrack" aria-hidden="true">
          <span className="toggleThumb" />
        </span>
        <span style={{ fontSize: '0.82rem', maxWidth: '11rem' }}>
          Шаг мартингейла
        </span>
      </label>

      <button
        type="button"
        className="btn btnSecondary"
        onClick={() => {
          setSignalId('');
          setSource('');
          setPair('');
          setStatus('');
          setIncludeDeleted(false);
          setSortBy('createdAt');
          setRefreshPnl(false);
          setMartingaleSteps(false);
          router.replace(pathname);
        }}
      >
        Сброс
      </button>
    </div>
  );
}

