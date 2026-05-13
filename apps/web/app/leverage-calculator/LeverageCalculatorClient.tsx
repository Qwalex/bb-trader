'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchJson } from '../../lib/api';

import { LeverageCalculatorCharts } from './LeverageCalculatorCharts';
import {
  DEFAULT_LEVERAGE_PRESET,
  buildPresetFromFormState,
  parseLeveragePresetJson,
  serializeLeveragePreset,
  LEVERAGE_CALCULATOR_PRESET_KEY,
} from './leverage-calculator-preset.util';
import type { LeverageCalculatorPresetV1 } from './leverage-calculator-page.types';
import type { LeverageCalcMode } from './leverage-calculator-page.util';
import {
  buildMonthlyCapitalTrajectory,
  computeContractEndDate,
  computeLeverageOutlook,
  formatDateRuLong,
  formatMonths,
  formatUsd,
  parseIsoDateOnly,
  todayIsoDateOnly,
} from './leverage-calculator-page.util';

export type LeverageCalculatorPayload = {
  equityUsd: number | null;
  expectedPnlPerDayUsd: number | null;
  realizedPnlPerDayUsd: number | null;
  statsPeriodDaysMax: number | null;
  totalPnlUsd: number;
  cabinetCount: number;
};

type SaveState = 'idle' | 'saving' | 'saved' | 'err';

export function LeverageCalculatorClient({
  payload,
  initialPresetJson,
  cabinetIdForApi,
}: {
  payload: LeverageCalculatorPayload;
  initialPresetJson: string | null;
  cabinetIdForApi: string;
}) {
  const [principal, setPrincipal] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return String(p.principalUsd);
  });
  const [monthly, setMonthly] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return String(p.monthlyPaymentUsd);
  });
  const [termYears, setTermYears] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return String(p.termYears);
  });
  const [horizonAfter, setHorizonAfter] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return String(p.horizonMonthsAfterLoan);
  });
  const [mode, setMode] = useState<LeverageCalcMode>(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return p.mode;
  });
  const [loanStartIso, setLoanStartIso] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    const s = String(p.loanStartIso ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayIsoDateOnly();
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersistOnce = useRef(true);

  useEffect(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    setPrincipal(String(p.principalUsd));
    setMonthly(String(p.monthlyPaymentUsd));
    setTermYears(String(p.termYears));
    setHorizonAfter(String(p.horizonMonthsAfterLoan));
    setMode(p.mode);
    setLoanStartIso(
      /^\d{4}-\d{2}-\d{2}$/.test(String(p.loanStartIso ?? '').trim())
        ? String(p.loanStartIso).trim()
        : todayIsoDateOnly(),
    );
    skipPersistOnce.current = true;
  }, [initialPresetJson]);

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
    if (equityNum <= 0) return null;
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

  const rDaily = outlook?.rDaily ?? null;

  const trajectory = useMemo(() => {
    if (equityNum <= 0 || rDaily == null || !Number.isFinite(rDaily) || rDaily <= -1) {
      return [];
    }
    return buildMonthlyCapitalTrajectory({
      equityUsd: equityNum,
      loanPrincipalUsd: loan.principalUsd,
      monthlyPaymentUsd: loan.monthlyPaymentUsd,
      termMonths: loan.termMonths,
      horizonMonthsAfter: horizonMonthsAfterLoan,
      rDaily,
    });
  }, [equityNum, rDaily, loan, horizonMonthsAfterLoan]);

  const loanStartDate = useMemo(() => parseIsoDateOnly(loanStartIso) ?? new Date(), [loanStartIso]);
  const contractEndDate = useMemo(
    () => computeContractEndDate(loanStartDate, loan.termMonths),
    [loanStartDate, loan.termMonths],
  );
  const contractEndLabel = useMemo(() => formatDateRuLong(contractEndDate), [contractEndDate]);

  const persistPreset = useCallback(
    async (preset: LeverageCalculatorPresetV1) => {
      const value = serializeLeveragePreset(preset);
      await fetchJson(
        '/settings',
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: LEVERAGE_CALCULATOR_PRESET_KEY, value }),
        },
        cabinetIdForApi,
      );
    },
    [cabinetIdForApi],
  );

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (skipPersistOnce.current) {
        skipPersistOnce.current = false;
        return;
      }
      const preset = buildPresetFromFormState({
        principalUsd: Number.parseFloat(principal.replace(',', '.')) || 0,
        monthlyPaymentUsd: Number.parseFloat(monthly.replace(',', '.')) || 0,
        termYears: Number.parseFloat(termYears.replace(',', '.')) || 0,
        horizonMonthsAfterLoan: Number.parseInt(horizonAfter, 10) || 0,
        mode,
        loanStartIso,
      });
      setSaveState('saving');
      setSaveMsg(null);
      void persistPreset(preset)
        .then(() => {
          setSaveState('saved');
          setTimeout(() => setSaveState('idle'), 2000);
        })
        .catch(() => {
          setSaveState('err');
          setSaveMsg('Не удалось сохранить параметры в аккаунт. Проверьте авторизацию.');
        });
    }, 900);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [principal, monthly, termYears, horizonAfter, mode, loanStartIso, persistPreset]);

  return (
    <div className="leveragePage">
      <header className="leverageHero">
        <div>
          <h1 className="leverageTitle">Кредит и доходность по всем кабинетам</h1>
          <p className="leverageLead">
            Сводка с дашборда: суммарный equity, ожидаемый и грубо реализованный PnL в день. Займ
            увеличивает торговый капитал; ниже — когда по календарю заканчивается срок кредита,
            оценка потоков и упрощённый график капитала.
          </p>
        </div>
        <div className="leverageSaveBadge" data-state={saveState}>
          {saveState === 'saving' && 'Сохранение…'}
          {saveState === 'saved' && 'Сохранено в аккаунт'}
          {saveState === 'err' && 'Ошибка сохранения'}
          {saveState === 'idle' && 'Параметры сохраняются автоматически'}
        </div>
      </header>
      {saveMsg && <p className="msg err">{saveMsg}</p>}

      <section className="leverageKpiRow">
        <article className="leverageKpi">
          <span className="leverageKpiLabel">Кабинетов в сводке</span>
          <strong className="leverageKpiValue">{payload.cabinetCount}</strong>
        </article>
        <article className="leverageKpi">
          <span className="leverageKpiLabel">Суммарный equity</span>
          <strong className="leverageKpiValue">{formatUsd(payload.equityUsd, 2)}</strong>
        </article>
        <article className="leverageKpi">
          <span className="leverageKpiLabel">Ожидаемый PnL / день</span>
          <strong className="leverageKpiValue">{formatUsd(payload.expectedPnlPerDayUsd, 4)}</strong>
        </article>
        <article className="leverageKpi">
          <span className="leverageKpiLabel">Реализ. PnL / день (оценка)</span>
          <strong className="leverageKpiValue">{formatUsd(payload.realizedPnlPerDayUsd, 4)}</strong>
        </article>
      </section>

      <div className="leverageGrid">
        <section className="card leveragePanel">
          <h2 className="leverageSectionTitle">Параметры кредита</h2>
          <p className="leverageMuted">
            Значения пишутся в настройку аккаунта <code>{LEVERAGE_CALCULATOR_PRESET_KEY}</code> и
            подставляются при следующем визите.
          </p>
          <div
            className="settingsForm leverageFormGrid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: '0.85rem',
              alignItems: 'end',
              marginTop: '1rem',
            }}
          >
            <label>
              <span className="leverageFieldLabel">Сумма кредита, USDT</span>
              <input
                type="text"
                inputMode="decimal"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
            </label>
            <label>
              <span className="leverageFieldLabel">Платёж в месяц, USDT</span>
              <input
                type="text"
                inputMode="decimal"
                value={monthly}
                onChange={(e) => setMonthly(e.target.value)}
              />
            </label>
            <label>
              <span className="leverageFieldLabel">Срок, лет</span>
              <input
                type="text"
                inputMode="decimal"
                value={termYears}
                onChange={(e) => setTermYears(e.target.value)}
              />
            </label>
            <label>
              <span className="leverageFieldLabel">Дата начала (договор)</span>
              <input
                type="date"
                value={loanStartIso}
                onChange={(e) => setLoanStartIso(e.target.value)}
              />
            </label>
            <label>
              <span className="leverageFieldLabel">Горизонт после кредита, мес.</span>
              <input
                type="text"
                inputMode="numeric"
                value={horizonAfter}
                onChange={(e) => setHorizonAfter(e.target.value)}
              />
            </label>
          </div>
          <fieldset className="leverageModeFieldset">
            <legend>База для доходности r = PnL_день ÷ equity</legend>
            <label>
              <input
                type="radio"
                name="lev-mode"
                checked={mode === 'expected'}
                onChange={() => setMode('expected')}
              />{' '}
              Ожидаемая (EV по сделкам)
            </label>
            <label>
              <input
                type="radio"
                name="lev-mode"
                checked={mode === 'realized'}
                onChange={() => setMode('realized')}
              />{' '}
              Реализованная (грубо по истории)
            </label>
          </fieldset>
        </section>

        <section className="card leveragePanel leverageHighlight">
          <h2 className="leverageSectionTitle">Когда кредит закрыт по договору</h2>
          <p className="leverageCloseDate">{contractEndLabel}</p>
          <ul className="leverageFactList">
            <li>
              <strong>Срок в месяцах:</strong> {loan.termMonths > 0 ? `${loan.termMonths} мес.` : '—'}
            </li>
            <li>
              <strong>Всего выплат по графику:</strong>{' '}
              {loan.termMonths > 0 && loan.monthlyPaymentUsd > 0
                ? formatUsd(loan.monthlyPaymentUsd * loan.termMonths, 2)
                : '—'}
            </li>
            <li>
              <strong>Тело кредита:</strong> {formatUsd(loan.principalUsd, 2)}
            </li>
          </ul>
          <p className="leverageFootnote">
            Дата = дата начала + число месяцев срока (календарно). Фактический день последнего
            платежа у банка может отличаться — уточните в договоре.
          </p>
        </section>
      </div>

      {equityNum <= 0 && (
        <p className="msg err leverageSpaced">
          Нет суммарного equity по кабинетам с балансом — проверьте ключи Bybit. Расчёты недоступны.
        </p>
      )}

      {equityNum > 0 && outlook && (
        <>
          <section className="card leverageSpaced">
            <h2 className="leverageSectionTitle">Показатели по модели</h2>
            {outlook.warnings.map((w) => (
              <p key={w} className="msg err" style={{ margin: '0.35rem 0' }}>
                {w}
              </p>
            ))}
            <div className="leverageMetricsGrid">
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Капитал с займом (E + L)</span>
                <span className="leverageMetricVal">{formatUsd(outlook.capitalWithLoanUsd)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Доходность r (оценка)</span>
                <span className="leverageMetricVal">
                  {outlook.rDaily != null ? `${(outlook.rDaily * 100).toFixed(4)}% / день` : '—'}
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Валовый PnL / месяц (старт)</span>
                <span className="leverageMetricVal">{formatUsd(outlook.grossMonthlyStartUsd)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Чистый поток / месяц после платежа</span>
                <span className="leverageMetricVal">{formatUsd(outlook.netMonthlyStartUsd)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Точка безубыточности капитала C*</span>
                <span className="leverageMetricVal">{formatUsd(outlook.breakEvenCapitalUsd)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Запас до C* (C₀ − C*)</span>
                <span className="leverageMetricVal">{formatUsd(outlook.surplusVsBreakEvenUsd)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Переплата (выплаты − тело)</span>
                <span className="leverageMetricVal">{formatUsd(outlook.overpaymentUsd)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Окупаемость переплаты (линейно)</span>
                <span className="leverageMetricVal">{formatMonths(outlook.monthsToRecoverOverpayment)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Капитал после срока кредита</span>
                <span className="leverageMetricVal">{formatUsd(outlook.capitalAfterLoanUsd)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">
                  Через {horizonMonthsAfterLoan} мес. после кредита
                </span>
                <span className="leverageMetricVal">{formatUsd(outlook.capitalAfterHorizonUsd)}</span>
              </div>
            </div>
            <p className="leverageFootnote" style={{ marginTop: '1.25rem' }}>
              Модель: каждый месяц капитал × (1 + r)³⁰ минус платёж; r не меняется. Реальность:
              просадки, комиссии, изменение объёма позиций и условия банка — не учитываются.
            </p>
          </section>

          <section className="card leverageSpaced">
            <h2 className="leverageSectionTitle">График: капитал и выплаты по месяцам</h2>
            <LeverageCalculatorCharts data={trajectory} termMonths={loan.termMonths} />
          </section>
        </>
      )}
    </div>
  );
}
