'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { fetchApiResponse } from '../../lib/api';

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

type RecalcClosedPnlJobStatus = {
  ok: boolean;
  jobId?: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  dryRun: boolean;
  limit: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: RecalcClosedPnlResult;
  error?: string;
};

export function RecalcClosedPnlButton({ limit }: { limit: number }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  async function startJob(dryRun: boolean): Promise<RecalcClosedPnlJobStatus> {
    const res = await fetchApiResponse('/bybit/recalc-closed-pnl', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun, limit, async: true }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `${res.status} ${res.statusText}`);
    }

    return (await res.json()) as RecalcClosedPnlJobStatus;
  }

  async function pollJob(jobId: string): Promise<RecalcClosedPnlJobStatus> {
    for (;;) {
      const res = await fetchApiResponse(`/bybit/recalc-closed-pnl/${encodeURIComponent(jobId)}`);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `${res.status} ${res.statusText}`);
      }
      const status = (await res.json()) as RecalcClosedPnlJobStatus;
      if (!status.ok) {
        throw new Error(status.error ?? 'Не удалось получить статус job');
      }
      if (status.status === 'completed' || status.status === 'failed') {
        return status;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
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

      setMessage({ type: 'ok', text: 'dry-run запущен, ожидаю завершения…' });
      const previewJob = await startJob(true);
      if (!previewJob.jobId) {
        throw new Error(previewJob.error ?? 'Не получен jobId dry-run');
      }
      const previewDone = await pollJob(previewJob.jobId);
      const preview = previewDone.result;
      if (!preview) {
        throw new Error(previewDone.error ?? 'dry-run завершился без результата');
      }
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

      setMessage({ type: 'ok', text: 'Запись пересчёта запущена, ожидаю завершения…' });
      const applyJob = await startJob(false);
      if (!applyJob.jobId) {
        throw new Error(applyJob.error ?? 'Не получен jobId записи');
      }
      const applyDone = await pollJob(applyJob.jobId);
      const applied = applyDone.result;
      if (!applied) {
        throw new Error(applyDone.error ?? 'Пересчёт завершился без результата');
      }
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

