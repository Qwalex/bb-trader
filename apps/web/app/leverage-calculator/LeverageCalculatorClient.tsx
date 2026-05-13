'use client';

import { useMemo, useState } from 'react';

import type { LeverageCalcMode } from './leverage-calculator-page.util';
import {
  computeLeverageOutlook,
  formatMonths,
  formatUsd,
} from './leverage-calculator-page.util';

export type LeverageCalculatorPayload = {
  equityUsd: number | null;
  expectedPnlPerDayUsd: number | null;
  realizedPnlPerDayUsd: number | null;
  statsPeriodDaysMax: number | null;
  totalPnlUsd: number;
  cabinetCount: number;
};

const DEFAULT_LOAN = {
  principalUsd: 650,
  monthlyPaymentUsd: 40,
  termYears: 2,
};

export function LeverageCalculatorClient({
  payload,
}: {
  payload: LeverageCalculatorPayload;
}) {
  const [principal, setPrincipal] = useState(String(DEFAULT_LOAN.principalUsd));
  const [monthly, setMonthly] = useState(String(DEFAULT_LOAN.monthlyPaymentUsd));
  const [termYears, setTermYears] = useState(String(DEFAULT_LOAN.termYears));
  const [horizonAfter, setHorizonAfter] = useState('12');
  const [mode, setMode] = useState<LeverageCalcMode>('expected');

  const equityNum = payload.equityUsd != null && payload.equityUsd > 0 ? payload.equityUsd : 0;

  const loan = useMemo(() => {
    const L = Number.parseFloat(principal.replace(',', '.')) || 0;
    const M = Number.parseFloat(monthly.replace(',', '.')) || 0;
    const y = Number.parseFloat(termYears.replace(',', '.')) || 0;
    const termMonths = Math.max(0, Math.round(y * 12));
    return { principalUsd: L, monthlyPaymentUsd: M, termMonths };
  }, [principal, monthly, termYears]);

  const horizonMonthsAfterLoan = useMemo(() => {
    const h = Number.parseInt(horizonAfter, 10);
    return Number.isFinite(h) ? Math.max(0, h) : 0;
  }, [horizonAfter]);

  const outlook = useMemo(() => {
    if (equityNum <= 0) {
      return null;
    }
    return computeLeverageOutlook({
      equityUsd: equityNum,
      expectedPnlPerDayUsd: payload.expectedPnlPerDayUsd,
      realizedPnlPerDayUsd: payload.realizedPnlPerDayUsd,
      mode,
      loan,
      horizonMonthsAfterLoan,
    });
  }, [
    equityNum,
    payload.expectedPnlPerDayUsd,
    payload.realizedPnlPerDayUsd,
    mode,
    loan,
    horizonMonthsAfterLoan,
  ]);

  return (
    <div className="card" style={{ maxWidth: 920 }}>
      <h1 style={{ marginTop: 0 }}>Калькулятор: кредит и доходность по всем кабинетам</h1>
      <p style={{ opacity: 0.92, lineHeight: 1.5 }}>
        Данные берутся из сводки{' '}
        <code style={{ fontSize: '0.9em' }}>GET /orders/dashboard-cabinets</code> (все доступные
        кабинеты). Equity — сумма <code>totalBalanceUsd</code> по кабинетам, где баланс известен.
        Ожидаемый PnL/день — сумма по кабинетам «сделок в день × EV сделки», как на главной.
        Реализованный PnL/день — <code>totalPnl / max(statsPeriodDays)</code> по карточкам
        (консервативная грубая оценка окна истории).
      </p>

      <section style={{ marginTop: '1.25rem' }}>
        <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Исходные данные</h2>
        <dl
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '0.35rem 1rem',
            margin: 0,
          }}
        >
          <dt>Кабинетов</dt>
          <dd style={{ margin: 0 }}>{payload.cabinetCount}</dd>
          <dt>Суммарный equity</dt>
          <dd style={{ margin: 0 }}>{formatUsd(payload.equityUsd)}</dd>
          <dt>Ожидаемый PnL / день (Σ)</dt>
          <dd style={{ margin: 0 }}>{formatUsd(payload.expectedPnlPerDayUsd)}</dd>
          <dt>Реализованный PnL / день (оценка)</dt>
          <dd style={{ margin: 0 }}>{formatUsd(payload.realizedPnlPerDayUsd)}</dd>
          <dt>Σ PnL за период статистики</dt>
          <dd style={{ margin: 0 }}>{formatUsd(payload.totalPnlUsd)}</dd>
          <dt>max(statsPeriodDays)</dt>
          <dd style={{ margin: 0 }}>
            {payload.statsPeriodDaysMax != null ? `${payload.statsPeriodDaysMax} дн.` : '—'}
          </dd>
        </dl>
      </section>

      {equityNum <= 0 && (
        <p className="msg err" style={{ marginTop: '1rem' }}>
          Нет суммарного equity (проверьте ключи Bybit и баланс по кабинетам). Калькулятор
          масштабирования от капитала недоступен.
        </p>
      )}

      {equityNum > 0 && (
        <>
          <section style={{ marginTop: '1.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.75rem' }}>Параметры кредита</h2>
            <div
              className="settingsForm"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '0.75rem',
                alignItems: 'end',
              }}
            >
              <label>
                <span style={{ display: 'block', fontSize: '0.85em', opacity: 0.85 }}>
                  Сумма кредита, USDT
                </span>
                <input type="text" inputMode="decimal" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: '0.85em', opacity: 0.85 }}>
                  Ежемесячный платёж, USDT
                </span>
                <input type="text" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: '0.85em', opacity: 0.85 }}>
                  Срок, лет
                </span>
                <input type="text" inputMode="decimal" value={termYears} onChange={(e) => setTermYears(e.target.value)} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: '0.85em', opacity: 0.85 }}>
                  Горизонт после кредита, мес.
                </span>
                <input type="text" inputMode="numeric" value={horizonAfter} onChange={(e) => setHorizonAfter(e.target.value)} />
              </label>
            </div>
            <fieldset style={{ marginTop: '1rem', border: 'none', padding: 0 }}>
              <legend style={{ fontSize: '0.85em', opacity: 0.85, marginBottom: '0.35rem' }}>
                База для r = PnL_день / equity
              </legend>
              <label style={{ marginRight: '1rem' }}>
                <input
                  type="radio"
                  name="lev-mode"
                  checked={mode === 'expected'}
                  onChange={() => setMode('expected')}
                />{' '}
                Ожидаемая (EV)
              </label>
              <label>
                <input
                  type="radio"
                  name="lev-mode"
                  checked={mode === 'realized'}
                  onChange={() => setMode('realized')}
                />{' '}
                Реализованная (грубо)
              </label>
            </fieldset>
          </section>

          {outlook && (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>Результаты</h2>
              {outlook.warnings.map((w) => (
                <p key={w} className="msg err" style={{ margin: '0.35rem 0' }}>
                  {w}
                </p>
              ))}
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  gap: '0.35rem 1rem',
                  margin: '0.75rem 0 0',
                }}
              >
                <dt>Капитал с займом (E+L)</dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.capitalWithLoanUsd)}</dd>
                <dt>Дневная доходность r (оценка)</dt>
                <dd style={{ margin: 0 }}>
                  {outlook.rDaily != null ? `${(outlook.rDaily * 100).toFixed(4)}% / день` : '—'}
                </dd>
                <dt>Валовый PnL / месяц (старт)</dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.grossMonthlyStartUsd)}</dd>
                <dt>Чистый поток / месяц (старт, после платежа)</dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.netMonthlyStartUsd)}</dd>
                <dt>Эквивалент платежа в день</dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.dailyLoanBurdenUsd)}</dd>
                <dt>Точка безубыточности капитала C*</dt>
                <dd style={{ margin: 0 }}>
                  {formatUsd(outlook.breakEvenCapitalUsd)} — при которой валовый месячный PnL ≈
                  платёж (линейная модель).
                </dd>
                <dt>Запас к C* (C₀ − C*)</dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.surplusVsBreakEvenUsd)}</dd>
                <dt>Всего выплат по графику</dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.totalPaidUsd)}</dd>
                <dt>Переплата (выплаты − тело)</dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.overpaymentUsd)}</dd>
                <dt>Срок окупаемости переплаты (линейно)</dt>
                <dd style={{ margin: 0 }}>{formatMonths(outlook.monthsToRecoverOverpayment)}</dd>
                <dt>Капитал после срока кредита (месячная модель)</dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.capitalAfterLoanUsd)}</dd>
                <dt>
                  Перспектива через {horizonMonthsAfterLoan} мес. после кредита (без платежа)
                </dt>
                <dd style={{ margin: 0 }}>{formatUsd(outlook.capitalAfterHorizonUsd)}</dd>
              </dl>
              <p style={{ marginTop: '1rem', fontSize: '0.88em', opacity: 0.88, lineHeight: 1.45 }}>
                Модель упрощённая: каждый месяц капитал умножается на{' '}
                <code>(1+r)³⁰</code> и вычитается платёж; r берётся из текущей оценки и не
                меняется. Реальная торговля, просадки и комиссии биржи могут сильно отличаться.
                Кредитные риски, ставки и график погашения у конкретного кредитора не моделируются
                — только заданные вами сумма, срок и платёж.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
