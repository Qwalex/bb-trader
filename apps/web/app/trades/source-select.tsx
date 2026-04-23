'use client';

import { useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

import { fetchApiResponse } from '../../lib/api';

type Props = {
  signalId: string;
  status: string;
  currentSource: string | null;
  options: string[];
};

export function SourceSelect({
  signalId,
  status,
  currentSource,
  options,
}: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const isDisabled = saving || status === 'FAILED';

  const optionList = useMemo(() => {
    const cur = currentSource ? currentSource.trim() : '';
    const merged = Array.from(
      new Set<string>([...options, ...(cur ? [cur] : [])]),
    );
    merged.sort((a, b) => a.localeCompare(b, 'ru'));
    return merged;
  }, [currentSource, options]);

  async function onChange(next: string) {
    if (isDisabled) return;
    const normalized = next.trim();
    const nextSource = normalized.length > 0 ? normalized : null;
    const from = currentSource ?? '—';
    const to = nextSource ?? '—';
    const ok = window.confirm(
      `Изменить source для сделки и связанных сигналов?\n\n${from} → ${to}`,
    );
    if (!ok) return;

    setSaving(true);
    try {
      const res = await fetchApiResponse(`/orders/trades/${signalId}/source`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: nextSource }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(text || `${res.status} ${res.statusText}`);
      }
      router.refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка обновления source';
      window.alert(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      disabled={isDisabled}
      value={currentSource ?? ''}
      onChange={(e) => void onChange(e.target.value)}
      style={{
        width: '100%',
        padding: '0.35rem 0.5rem',
        background: 'var(--card)',
        color: 'var(--foreground)',
        border: '1px solid var(--border)',
        borderRadius: 6,
      }}
    >
      <option value="">— (без source)</option>
      {optionList.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

