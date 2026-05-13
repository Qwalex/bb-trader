'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { TrajectoryPoint } from './leverage-calculator-page.util';

type Props = {
  data: TrajectoryPoint[];
  termMonths: number;
};

function formatK(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}

export function LeverageCalculatorCharts({ data, termMonths }: Props) {
  if (data.length < 2) {
    return (
      <p className="leverageMuted" style={{ margin: 0 }}>
        Недостаточно данных для графика (проверьте срок кредита и доходность).
      </p>
    );
  }

  const chartData = data.map((row) => ({
    ...row,
    monthLabel: row.month === 0 ? 'Старт' : `М${row.month}`,
  }));

  const endLoanLabel = termMonths <= 0 ? 'Старт' : `М${termMonths}`;

  return (
    <div className="leverageCharts">
      <div className="chartWrap" style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="monthLabel" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
            <YAxis
              yAxisId="left"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickFormatter={formatK}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickFormatter={formatK}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 8,
              }}
              formatter={(value, name) => {
                const n = typeof value === 'number' ? value : Number(value);
                const label =
                  name === 'capitalUsd'
                    ? 'Капитал (модель)'
                    : name === 'cumulativePaidUsd'
                      ? 'Выплачено банку Σ'
                      : String(name ?? '');
                return [
                  Number.isFinite(n) ? `${n.toFixed(2)} USDT` : '—',
                  label,
                ];
              }}
            />
            <Legend />
            {termMonths > 0 && chartData.some((d) => d.monthLabel === endLoanLabel) && (
              <ReferenceLine
                x={endLoanLabel}
                stroke="var(--accent)"
                strokeDasharray="4 4"
                label={{
                  value: 'конец кредита',
                  fill: 'var(--muted)',
                  fontSize: 11,
                }}
              />
            )}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="capitalUsd"
              name="Капитал"
              stroke="#7dd3fc"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumulativePaidUsd"
              name="Выплачено Σ"
              stroke="#c4b5fd"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="leverageFootnote">
        Слева — капитал на счёте (оценка). Справа — накопленные платежи по кредиту; вертикальная
        линия — последний месяц выплат по введённому сроку.
      </p>
    </div>
  );
}
