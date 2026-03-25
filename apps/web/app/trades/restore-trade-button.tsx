'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getApiBase } from '../../lib/api';

export function RestoreTradeButton(props: { tradeId: string; pair: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onRestore() {
    if (loading) return;
    const ok = window.confirm(`Восстановить сделку ${props.pair}?`);
    if (!ok) return;

    setLoading(true);
    try {
      const res = await fetch(
        `${getApiBase()}/orders/trades/${props.tradeId}/restore`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка восстановления';
      window.alert(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onRestore}
      disabled={loading}
      title="Восстановить сделку"
      style={{
        padding: '0.3rem 0.55rem',
        borderRadius: 6,
        border: '1px solid #2d7a3d',
        background: loading ? '#2a2a2a' : '#1f4a2a',
        color: '#fff',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.55 : 1,
      }}
    >
      {loading ? '…' : 'Восстановить'}
    </button>
  );
}

