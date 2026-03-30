'use client';

import type { CSSProperties } from 'react';

import type { EntrySizingMode } from '../../lib/entry-sizing';

type Props = {
  mode: EntrySizingMode;
  amount: string;
  onChange: (mode: EntrySizingMode, amount: string) => void;
  onBlur?: (mode: EntrySizingMode, amount: string) => void;
  /** После переключения USDT / % (для немедленного сохранения в таблице чатов). */
  onModeChange?: (mode: EntrySizingMode, amount: string) => void;
  disabled?: boolean;
  /** Подпись над переключателем */
  label?: string;
  inputId?: string;
  compact?: boolean;
};

const btnBase: CSSProperties = {
  padding: '0.35rem 0.65rem',
  fontSize: '0.85rem',
  borderRadius: 6,
  border: '1px solid var(--border)',
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--foreground)',
};

export function EntrySizingControl({
  mode,
  amount,
  onChange,
  onBlur,
  onModeChange,
  disabled,
  label,
  inputId,
  compact,
}: Props) {
  const active = (m: EntrySizingMode) =>
    mode === m
      ? { ...btnBase, background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
      : btnBase;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '0.35rem' : '0.5rem' }}>
      {label ? (
        <span style={{ fontSize: compact ? '0.8rem' : '0.9rem', color: 'var(--muted)' }}>{label}</span>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
        <div style={{ display: 'inline-flex', gap: 2, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
          <button
            type="button"
            disabled={disabled}
            style={{
              ...active('usdt'),
              border: 'none',
              borderRadius: 0,
            }}
            onClick={() => {
              onChange('usdt', amount);
              onModeChange?.('usdt', amount);
            }}
          >
            USDT
          </button>
          <button
            type="button"
            disabled={disabled}
            style={{
              ...active('percent'),
              border: 'none',
              borderRadius: 0,
            }}
            onClick={() => {
              onChange('percent', amount);
              onModeChange?.('percent', amount);
            }}
          >
            %
          </button>
        </div>
        <input
          id={inputId}
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          disabled={disabled}
          value={amount}
          placeholder={mode === 'percent' ? 'напр. 5' : 'напр. 10'}
          onChange={(e) => onChange(mode, e.target.value)}
          onBlur={() => onBlur?.(mode, amount)}
          style={{
            width: compact ? '5.5rem' : '7rem',
            padding: '0.4rem 0.5rem',
            borderRadius: 4,
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--foreground)',
          }}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
          {mode === 'percent' ? '% от суммарного баланса' : 'USDT'}
        </span>
      </div>
    </div>
  );
}
