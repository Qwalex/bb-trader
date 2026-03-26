'use client';

import type { ReactNode } from 'react';
import { useId, useState } from 'react';

import { useRouter } from 'next/navigation';

import { getApiBase } from '../../lib/api';

type Props = {
  signalId: string;
  status: string;
  realizedPnl: number | null;
  disabled?: boolean;
  children: ReactNode;
};

const EDITABLE_STATUSES = new Set(['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED']);

export function PnlEditControl({ signalId, status, realizedPnl, disabled, children }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const helpId = useId();
  const isDisabled = disabled || saving || !EDITABLE_STATUSES.has(status);

  async function onEdit() {
    if (isDisabled) return;
    const raw = window.prompt(
      'Введите скорректированный realized PnL.\nОставьте пусто, чтобы очистить PnL (CLOSED_MIXED).',
      realizedPnl == null ? '' : String(realizedPnl),
    );
    if (raw === null) {
      return;
    }
    const normalized = raw.trim().replace(',', '.');
    const nextPnl =
      normalized === '' ? null : Number.parseFloat(normalized);
    if (nextPnl !== null && !Number.isFinite(nextPnl)) {
      window.alert('Некорректное число PnL');
      return;
    }
    const ok = window.confirm(
      `Сохранить PnL для сделки?\n\nТекущее: ${realizedPnl ?? '—'}\nНовое: ${nextPnl ?? '—'}`,
    );
    if (!ok) {
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${getApiBase()}/orders/trades/${signalId}/pnl`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ realizedPnl: nextPnl }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка обновления PnL';
      window.alert(msg);
    } finally {
      setSaving(false);
    }
  }

  const title = EDITABLE_STATUSES.has(status)
    ? 'Скорректировать realized PnL'
    : `Для статуса ${status} корректировка PnL недоступна`;

  return (
    <>
      <button
        className="pnlEditTrigger"
        type="button"
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-describedby={helpId}
        onClick={() => void onEdit()}
        title={title}
      >
        {children}
      </button>
      <span id={helpId} className="srOnly">
        {saving ? 'Сохранение…' : title}
      </span>
    </>
  );
}

