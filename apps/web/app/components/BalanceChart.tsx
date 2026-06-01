'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { displayTimeZone, displayTimeZoneLabel } from '../../lib/datetime';

export type BalancePoint = {
  at: string;
  totalUsd: number;
};

function formatAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: displayTimeZone(),
    });
  } catch {
    return iso;
  }
}

export function BalanceChart({
  data,
  compact,
  balanceLabel,
}: {
  data: BalancePoint[];
  /** Компактный режим для вложенных блоков (например «Все кабинеты»). */
  compact?: boolean;
  /** Подпись в тултипе (по умолчанию «Суммарный баланс»). */
  balanceLabel?: string;
}) {
  const label = balanceLabel ?? 'Суммарный баланс';
  if (data.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', padding: compact ? '0.5rem 0.35rem' : '1rem', fontSize: compact ? '0.78rem' : undefined }}>
        {compact
          ? `Нет точек: снимки equity появятся после ежедневного cron (≈00:05 ${displayTimeZoneLabel()}).`
          : `Записей пока нет. Точки появятся после ежедневного снимка суммарного баланса (cron API, около 00:05 ${displayTimeZoneLabel()}).`}
      </p>
    );
  }
  const chartData = data.map((p) => ({
    ...p,
    label: formatAt(p.at),
  }));
  const margin = compact
    ? { top: 4, right: 2, left: -6, bottom: 0 }
    : { top: 8, right: 8, left: 0, bottom: 4 };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={margin}>
        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#8b949e', fontSize: compact ? 9 : 10 }}
          interval="preserveStartEnd"
        />
        <YAxis width={compact ? 38 : 48} tick={{ fill: '#8b949e', fontSize: compact ? 9 : 10 }} />
        <Tooltip
          formatter={(value: number) => [`${value.toFixed(2)} USDT`, label]}
          contentStyle={{
            background: '#1a2332',
            border: '1px solid #30363d',
            fontSize: compact ? 12 : undefined,
          }}
        />
        <Line
          type="monotone"
          dataKey="totalUsd"
          name={label}
          stroke="#3b82f6"
          strokeWidth={compact ? 1.5 : 2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
