'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { fetchApiResponse } from '../../lib/api';
import { formatDateTimeRu } from '../../lib/datetime';
import { ApplyTpSlButton } from './apply-tpsl-button';
import type { StuckTradesSnapshot } from './stuck-trades.types';

type Props = {
  /** SSR-предзагрузка (опционально) */
  initial?: StuckTradesSnapshot | null;
};

export function StuckTradesBanner({ initial = null }: Props) {
  const router = useRouter();
  const [data, setData] = useState<StuckTradesSnapshot | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchApiResponse('/bybit/stuck-trades');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `${res.status}`);
      }
      const json = (await res.json()) as StuckTradesSnapshot;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось проверить сделки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initial) {
      void load();
    }
  }, [initial, load]);

  const hasItems = (data?.items.length ?? 0) > 0;
  const pollStuck = Boolean(data?.pollStuck);
  if (!loading && !error && !hasItems && !pollStuck) {
    return null;
  }

  return (
    <div className="stuckTradesBanner">
      <div className="stuckTradesBannerHead">
        <strong>Зависшие / незащищённые сделки</strong>
        <button type="button" className="btn btnSm" disabled={loading} onClick={() => void load()}>
          {loading ? '…' : 'Обновить'}
        </button>
      </div>
      {error && <p className="msg err">{error}</p>}
      {!data?.bybitConnected && !loading && (
        <p className="msg err" style={{ marginTop: '0.5rem' }}>
          Bybit не подключён — проверка позиций недоступна.
        </p>
      )}
      {pollStuck && (
        <p className="stuckTradesPollWarn">
          Фоновый poll кабинета завис
          {data?.pollLockedSince
            ? ` (с ${formatDateTimeRu(data.pollLockedSince)})`
            : ''}
          . TP/SL могут не обновляться — нажмите «TP / SL» у сделки или дождитесь auto-recovery
          (фоновый auto-heal ~каждые 3 мин).
        </p>
      )}
      {hasItems && (
        <ul className="stuckTradesList">
          {data!.items.map((item) => (
            <li key={item.signalId} className="stuckTradesListItem">
              <div className="stuckTradesListMain">
                <Link href={`/trades?signalId=${encodeURIComponent(item.signalId)}`}>
                  <strong>{item.pair}</strong>
                </Link>
                <span className="stuckTradesListMeta">
                  {item.direction} · {item.status}
                  {item.source ? ` · ${item.source}` : ''}
                </span>
                <span className="stuckTradesListSummary">{item.summary}</span>
                <ul className="stuckTradesIssueList">
                  {item.issues.map((issue) => (
                    <li key={issue.kind}>{issue.message}</li>
                  ))}
                </ul>
              </div>
              <ApplyTpSlButton
                signalId={item.signalId}
                pair={item.pair}
                status={item.status}
                compact
                onDone={() => {
                  void load();
                  router.refresh();
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {!loading && hasItems && (
        <p style={{ color: 'var(--muted)', fontSize: '0.85rem', margin: '0.5rem 0 0' }}>
          Фоновый auto-heal периодически синхронизирует вход и ставит TP/SL (до 2 сделок за проход).
          Кнопка «TP / SL» — немедленное исправление.
        </p>
      )}
      {!loading && !hasItems && pollStuck && !error && (
        <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '0.35rem 0 0' }}>
          Активных расхождений по сделкам не найдено, но poll кабинета требует внимания.
        </p>
      )}
    </div>
  );
}
