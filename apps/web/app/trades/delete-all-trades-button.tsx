'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getApiBase } from '../../lib/api';

type DeleteAllTradesResult = {
  ok: boolean;
  total: number;
  deleted: number;
  failed: number;
  errors: Array<{
    signalId: string;
    status: string;
    error: string;
  }>;
  stats: {
    winrate: number;
    wins: number;
    losses: number;
    totalClosed: number;
    totalPnl: number;
    openSignals: number;
  };
};

export function DeleteAllTradesButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  async function onClick() {
    if (loading) return;

    const firstConfirm = window.confirm(
      'Удалить все сделки?\n\nПроцесс пойдёт ПОСЛЕДОВАТЕЛЬНО по каждой сделке. Для активных сделок будет попытка снять ордера и закрыть позиции на Bybit. Это может занять много времени.',
    );
    if (!firstConfirm) return;

    const secondConfirm = window.confirm(
      'Подтвердите ещё раз: удалить все сделки и пересчитать статистику по новым данным?',
    );
    if (!secondConfirm) return;

    setLoading(true);
    setMessage({ type: 'ok', text: 'Запущено последовательное удаление всех сделок…' });
    try {
      const res = await fetch(`${getApiBase()}/orders/trades/delete-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `${res.status} ${res.statusText}`);
      }

      const result = (await res.json()) as DeleteAllTradesResult;
      const baseText = `Готово: удалено ${result.deleted}/${result.total}, ошибок: ${result.failed}.`;
      if (result.failed > 0) {
        const firstErr = result.errors[0];
        const tail = firstErr
          ? ` Первая ошибка: ${firstErr.status} ${firstErr.signalId.slice(0, 8)}… — ${firstErr.error}`
          : '';
        setMessage({
          type: 'err',
          text: `${baseText}${tail}`,
        });
      } else {
        setMessage({
          type: 'ok',
          text: `${baseText} Статистика пересчитана.`,
        });
      }
      router.refresh();
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Ошибка удаления',
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={loading}
        className="btnDanger"
        style={{ width: 'fit-content' }}
      >
        {loading ? 'Удаление…' : 'Удалить все сделки'}
      </button>
      {message && (
        <p className={`msg ${message.type === 'ok' ? 'ok' : 'err'}`} style={{ marginTop: '0.75rem' }}>
          {message.text}
        </p>
      )}
    </>
  );
}
