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
    });
  } catch {
    return iso;
  }
}

export function BalanceChart({ data }: { data: BalancePoint[] }) {
  if (data.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', padding: '1rem' }}>
        Записей пока нет. Точки появятся после ежедневного снимка суммарного баланса (cron API, около
        00:05 UTC).
      </p>
    );
  }
  const chartData = data.map((p) => ({
    ...p,
    label: formatAt(p.at),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#8b949e', fontSize: 10 }}
          interval="preserveStartEnd"
        />
        <YAxis width={48} tick={{ fill: '#8b949e', fontSize: 10 }} />
        <Tooltip
          formatter={(value: number) => [`${value.toFixed(2)} USDT`, 'Суммарный баланс']}
          contentStyle={{
            background: '#1a2332',
            border: '1px solid #30363d',
          }}
        />
        <Line
          type="monotone"
          dataKey="totalUsd"
          name="Суммарный баланс"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
