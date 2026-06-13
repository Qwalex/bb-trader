'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { fetchApiResponse } from '../../lib/api';

type ApplyTpSlResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  complete?: boolean;
  liveTpCount?: number;
  positionHasSl?: boolean;
  positionSize?: number;
};

const ACTIVE_STATUSES = new Set(['ORDERS_PLACED', 'OPEN', 'PARSED']);

export function canShowApplyTpSlButton(status: string, deletedAt?: string | null): boolean {
  if (deletedAt) return false;
  return ACTIVE_STATUSES.has(status);
}

export function ApplyTpSlButton(props: {
  signalId: string;
  pair: string;
  status: string;
  deletedAt?: string | null;
  compact?: boolean;
  onDone?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (!canShowApplyTpSlButton(props.status, props.deletedAt)) {
    return null;
  }

  async function onApply() {
    if (loading) return;
    const ok = window.confirm(
      `Синхронизировать ордера с Bybit и выставить TP/SL для ${props.pair}?\n\nИспользуйте, если вход уже исполнен, а защита не проставилась автоматически.`,
    );
    if (!ok) return;

    setLoading(true);
    try {
      const res = await fetchApiResponse(`/bybit/apply-tpsl/${props.signalId}`, {
        method: 'POST',
      });
      const json = (await res.json().catch(() => null)) as ApplyTpSlResponse | null;
      if (!res.ok) {
        throw new Error(json?.error ?? json?.message ?? `${res.status} ${res.statusText}`);
      }
      const parts: string[] = [json?.message ?? 'Готово'];
      if (typeof json?.liveTpCount === 'number') {
        parts.push(`TP-ордеров: ${json.liveTpCount}`);
      }
      if (json?.positionHasSl) {
        parts.push('SL на позиции: да');
      } else if (typeof json?.positionSize === 'number' && json.positionSize > 0) {
        parts.push('SL на позиции: нет');
      }
      if (!json?.complete && typeof json?.liveTpCount === 'number' && json.liveTpCount === 0) {
        parts.unshift('⚠ TP не выставлены полностью');
      }
      window.alert(parts.join('\n'));
      props.onDone?.();
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка постановки TP/SL';
      window.alert(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className={props.compact ? 'btn btnSm' : 'btn'}
      onClick={() => void onApply()}
      disabled={loading}
      title="Синхронизировать с Bybit и выставить TP/SL"
    >
      {loading ? '…' : 'TP / SL'}
    </button>
  );
}
