'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getApiBase } from '../../lib/api';

export function DeleteTradeButton(props: {
  tradeId: string;
  pair: string;
  status: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  const isDisabled =
    deleting ||
    props.status === 'ORDERS_PLACED' ||
    props.status === 'OPEN' ||
    props.status === 'PARSED';

  async function onDelete() {
    if (isDisabled) return;
    const ok = window.confirm(
      `Удалить сделку ${props.pair} из базы данных?\n\nСвязанные ордера в БД тоже будут удалены.`,
    );
    if (!ok) return;

    setDeleting(true);
    try {
      const res = await fetch(`${getApiBase()}/orders/trades/${props.tradeId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка удаления';
      window.alert(msg);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={isDisabled}
      title={
        isDisabled
          ? 'Активные сделки удалять нельзя'
          : 'Полностью удалить сделку из БД'
      }
      style={{
        padding: '0.3rem 0.55rem',
        borderRadius: 6,
        border: '1px solid #7a2d2d',
        background: isDisabled ? '#2a2a2a' : '#4a1f1f',
        color: '#fff',
        cursor: isDisabled ? 'not-allowed' : 'pointer',
        opacity: isDisabled ? 0.55 : 1,
      }}
    >
      {deleting ? 'Удаление…' : 'Удалить'}
    </button>
  );
}
