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
    const source = cleanString(sp.get('source') ?? '');
    const pair = cleanString(sp.get('pair') ?? '');
    const status = cleanString(sp.get('status') ?? '');
    const includeDeleted = sp.get('includeDeleted') === '1' || sp.get('includeDeleted') === 'true';
    return { source, pair, status, includeDeleted };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [source, setSource] = useState(initial.source);
  const [pair, setPair] = useState(initial.pair);
  const [status, setStatus] = useState(initial.status);
  const [includeDeleted, setIncludeDeleted] = useState(initial.includeDeleted);

  const pairTimer = useRef<number | null>(null);

  function replaceQuery(next: {
    source?: string;
    pair?: string;
    status?: string;
    includeDeleted?: boolean;
  }) {
    const q = new URLSearchParams(sp.toString());

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

    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  useEffect(() => {
    return () => {
      if (pairTimer.current) window.clearTimeout(pairTimer.current);
    };
  }, []);

  return (
    <div className="filters">
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

      <label className="toggle tradesFiltersToggle" title="Показать удаленные">
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

      <button
        type="button"
        className="btn btnSecondary"
        onClick={() => {
          setSource('');
          setPair('');
          setStatus('');
          setIncludeDeleted(false);
          router.replace(pathname);
        }}
      >
        Сброс
      </button>
    </div>
  );
}

