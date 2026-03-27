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
    deleting || props.status === 'OPEN' || props.status === 'PARSED';

  async function onDelete() {
    if (isDisabled) return;
    const isPlaced = props.status === 'ORDERS_PLACED';
    const ok = window.confirm(
      isPlaced
        ? `Удалить сделку ${props.pair}?\n\nНа Bybit будут отменены ордера по паре и закрыта позиция (если есть), затем сделка скроется из статистики (можно восстановить).`
        : `Удалить сделку ${props.pair} из базы данных?\n\nСделка будет скрыта из статистики и таблиц (можно восстановить).`,
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
        deleting
          ? 'Выполняется удаление…'
          : isDisabled
            ? 'Сделки OPEN/PARSED удалять нельзя'
            : isPlaced
              ? 'Снять ордера/позицию на Bybit и скрыть сделку'
              : 'Скрыть сделку (soft-delete)'
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
