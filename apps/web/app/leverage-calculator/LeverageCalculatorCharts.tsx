'use client';

import { useEffect, useState } from 'react';
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
  const [chartReady, setChartReady] = useState(false);
  useEffect(() => {
    setChartReady(true);
  }, []);

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
    capitalUsd: Number.isFinite(row.capitalUsd) ? row.capitalUsd : 0,
    cumulativePaidUsd: Number.isFinite(row.cumulativePaidUsd) ? row.cumulativePaidUsd : 0,
  }));

  const endLoanLabel = termMonths <= 0 ? 'Старт' : `М${termMonths}`;

  if (!chartReady) {
    return (
      <div className="leverageCharts">
        <div
          className="chartWrap"
          style={{ height: 320, minHeight: 320, width: '100%', minWidth: 0 }}
          aria-busy="true"
        />
      </div>
    );
  }

  return (
    <div className="leverageCharts">
      <div className="chartWrap" style={{ height: 320, minHeight: 320, width: '100%', minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={120} minHeight={280}>
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 4, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="monthLabel" tick={{ fill: 'var(--muted)', fontSize: 11 }} />
            <YAxis
              yAxisId="left"
              width={52}
              tick={{ fill: 'var(--muted)', fontSize: 11 }}
              tickFormatter={formatK}
            />
            <YAxis
              yAxisId="right"
              width={52}
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
            {termMonths > 0 && chartData.some((d) => d.monthLabel === endLoanLabel) ? (
              <ReferenceLine
                yAxisId="left"
                x={endLoanLabel}
                stroke="var(--accent)"
                strokeDasharray="4 4"
                label={{ value: 'конец кредита', fill: 'var(--muted)', fontSize: 11 }}
                ifOverflow="extendDomain"
              />
            ) : null}
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
