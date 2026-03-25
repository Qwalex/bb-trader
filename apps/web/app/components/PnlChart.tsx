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

type Point = { date: string; pnl: number };

export function PnlChart({ data }: { data: Point[] }) {
  if (data.length === 0) {
    return (
      <p style={{ color: 'var(--muted)', padding: '1rem' }}>Нет данных PnL</p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
        <XAxis
          dataKey="date"
          tick={{ fill: '#8b949e', fontSize: 10 }}
          interval="preserveStartEnd"
        />
        <YAxis width={44} tick={{ fill: '#8b949e', fontSize: 10 }} />
        <Tooltip
          contentStyle={{
            background: '#1a2332',
            border: '1px solid #30363d',
          }}
        />
        <Line
          type="monotone"
          dataKey="pnl"
          stroke="#3b82f6"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
