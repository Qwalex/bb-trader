'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { getApiBase } from '../../lib/api';

type RecalcClosedPnlResult = {
  ok: boolean;
  dryRun: boolean;
  scanned: number;
  updated: number;
  unchanged: number;
  skippedNoBybitOrders: number;
  skippedNoClosedPnl: number;
  errors: { signalId: string; error: string }[];
};

export function RecalcClosedPnlButton({ limit }: { limit: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  async function callApi(dryRun: boolean): Promise<RecalcClosedPnlResult> {
    const res = await fetch(`${getApiBase()}/bybit/recalc-closed-pnl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun, limit }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `${res.status} ${res.statusText}`);
    }

    return (await res.json()) as RecalcClosedPnlResult;
  }

  async function onClick() {
    if (loading) return;

    setMessage(null);
    setLoading(true);
    try {
      const okPreview = window.confirm(
        'Сделать dry-run пересчёта closed PnL (без записи в БД)?\n\nБудет показано, сколько сделок изменится.'
      );
      if (!okPreview) return;

      const preview = await callApi(true);
      if (preview.errors?.length) {
        setMessage({
          type: 'err',
          text: `dry-run: ошибки (${preview.errors.length}). Проверьте API логи.`,
        });
        return;
      }

      setMessage({
        type: 'ok',
        text: `dry-run: scanned=${preview.scanned}, updated=${preview.updated}, unchanged=${preview.unchanged}`,
      });

      const okApply = window.confirm(
        'Записать пересчёт в БД? (Это может занять время)'
      );
      if (!okApply) return;

      const applied = await callApi(false);
      if (applied.errors?.length) {
        setMessage({
          type: 'err',
          text: `Запись завершилась с ошибками (${applied.errors.length}).`,
        });
        return;
      }

      setMessage({
        type: 'ok',
        text: `Готово: updated=${applied.updated}, unchanged=${applied.unchanged}. Перезагружаю таблицу…`,
      });
      router.refresh();
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Ошибка пересчёта',
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
        {loading ? 'Пересчёт…' : 'Пересчитать closed PnL'}
      </button>
      {message && (
        <p
          className={`msg ${message.type === 'ok' ? 'ok' : 'err'}`}
          style={{ marginTop: '0.75rem' }}
        >
          {message.text}
        </p>
      )}
    </>
  );
}

