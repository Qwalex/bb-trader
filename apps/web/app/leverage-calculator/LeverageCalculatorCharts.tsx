'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { formatRubAmount } from './leverage-calculator-fx.util';

export type LeverageTrajectoryChartPoint = TrajectoryPoint & {
  /** Тот же r, только стартовый E и без займа/платежей: E·(1+r)³⁰ᵐ. */
  equityOnlyCapitalUsd: number;
  /** Капитал при досрочном закрытии (если сценарий задан). */
  capitalEarlyUsd?: number;
  cumulativePaidEarlyUsd?: number;
};

type Props = {
  data: LeverageTrajectoryChartPoint[];
  termMonths: number;
  /** Месяц, в конце которого в сценарии досрочного закрыт долг (для вертикали). */
  earlyCloseMonth: number | null;
  /** Курс ЦБ: рублей за 1 USD — для подписи в подсказке графика. */
  rubPerUsd: number | null;
};

function formatK(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return v.toFixed(0);
}

export function LeverageCalculatorCharts({ data, termMonths, earlyCloseMonth, rubPerUsd }: Props) {
  const [chartReady, setChartReady] = useState(false);
  useEffect(() => {
    setChartReady(true);
  }, []);

  const hasEarlyCapital = useMemo(
    () => data.some((row) => row.capitalEarlyUsd != null && Number.isFinite(row.capitalEarlyUsd)),
    [data],
  );
  const hasEarlyCumulative = useMemo(
    () =>
      data.some((row) => row.cumulativePaidEarlyUsd != null && Number.isFinite(row.cumulativePaidEarlyUsd)),
    [data],
  );

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
    equityOnlyCapitalUsd: Number.isFinite(row.equityOnlyCapitalUsd) ? row.equityOnlyCapitalUsd : 0,
    cumulativePaidUsd: Number.isFinite(row.cumulativePaidUsd) ? row.cumulativePaidUsd : 0,
    capitalEarlyUsd:
      row.capitalEarlyUsd != null && Number.isFinite(row.capitalEarlyUsd) ? row.capitalEarlyUsd : undefined,
    cumulativePaidEarlyUsd:
      row.cumulativePaidEarlyUsd != null && Number.isFinite(row.cumulativePaidEarlyUsd)
        ? row.cumulativePaidEarlyUsd
        : undefined,
  }));

  const endLoanLabel = termMonths <= 0 ? 'Старт' : `М${termMonths}`;
  const earlyLabel =
    earlyCloseMonth != null && earlyCloseMonth > 0 && earlyCloseMonth < termMonths
      ? `М${earlyCloseMonth}`
      : null;

  if (!chartReady) {
    return (
      <div className="leverageCharts">
        <div
          className="chartWrap"
          style={{ height: 360, minHeight: 360, width: '100%', minWidth: 0 }}
          aria-busy="true"
        />
      </div>
    );
  }

  return (
    <div className="leverageCharts">
      <div className="chartWrap" style={{ height: 360, minHeight: 360, width: '100%', minWidth: 0 }}>
        <ResponsiveContainer width="100%" height="100%" minWidth={120} minHeight={300}>
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
                    ? 'Капитал (по графику)'
                    : name === 'capitalEarlyUsd'
                      ? 'Капитал (досрочно)'
                      : name === 'equityOnlyCapitalUsd'
                        ? 'Только свой капитал E'
                        : name === 'cumulativePaidUsd'
                          ? 'Выплачено Σ (по графику)'
                          : name === 'cumulativePaidEarlyUsd'
                            ? 'Выплачено Σ (досрочно)'
                            : String(name ?? '');
                const usdStr = Number.isFinite(n) ? `${n.toFixed(2)} USDT` : '—';
                const rub =
                  rubPerUsd != null && rubPerUsd > 0 && Number.isFinite(n)
                    ? formatRubAmount(n * rubPerUsd, 0)
                    : null;
                return [rub ? `${usdStr} (~ ${rub})` : usdStr, label];
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
            {earlyLabel && chartData.some((d) => d.monthLabel === earlyLabel) ? (
              <ReferenceLine
                yAxisId="left"
                x={earlyLabel}
                stroke="#fbbf24"
                strokeDasharray="3 6"
                label={{ value: 'досрочное', fill: 'var(--muted)', fontSize: 11 }}
                ifOverflow="extendDomain"
              />
            ) : null}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="capitalUsd"
              name="Капитал (по графику)"
              stroke="#7dd3fc"
              strokeWidth={2}
              dot={false}
            />
            {hasEarlyCapital ? (
              <Line
                yAxisId="left"
                type="monotone"
                dataKey="capitalEarlyUsd"
                name="Капитал (досрочно)"
                stroke="#fcd34d"
                strokeWidth={2}
                strokeDasharray="4 3"
                dot={false}
                connectNulls
              />
            ) : null}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="equityOnlyCapitalUsd"
              name="Только E (без займа)"
              stroke="#86efac"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="cumulativePaidUsd"
              name="Выплачено Σ (график)"
              stroke="#c4b5fd"
              strokeWidth={2}
              dot={false}
            />
            {hasEarlyCumulative ? (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulativePaidEarlyUsd"
                name="Выплачено Σ (досрочно)"
                stroke="#f9a8d4"
                strokeWidth={2}
                strokeDasharray="5 3"
                dot={false}
                connectNulls
              />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="leverageFootnote">
        Слева — капитал по графику, при досрочном (если задан) и контроль «только E» на тех же r.
        Справа — накопленные выплаты банку: полный график и досрочный. Жёлтая вертикаль — месяц
        закрытия долга при досрочном; голубая — конец договорного срока без досрочного.
      </p>
    </div>
  );
}
