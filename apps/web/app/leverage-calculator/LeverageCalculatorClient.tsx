'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchJson } from '../../lib/api';
import { withAppBasePath } from '../../lib/base-path';

import { LeverageCalculatorCharts } from './LeverageCalculatorCharts';
import { DualUsdRub, DualUsdRubSigned } from './leverage-calculator-dual-money';
import {
  DEFAULT_LEVERAGE_PRESET,
  buildPresetFromFormState,
  parseLeveragePresetJson,
  serializeLeveragePreset,
  LEVERAGE_CALCULATOR_PRESET_KEY,
} from './leverage-calculator-preset.util';
import type {
  LeverageCalculatorPresetV1,
  LeverageCalculatorPayload,
  LeverageInputCurrency,
} from './leverage-calculator-page.types';
import type { LeverageCalcMode, LeverageLoanPaymentTiming } from './leverage-calculator-page.util';
import {
  buildLeverageAiAdviceRequest,
} from './leverage-calculator-ai.util';
import type { LeverageCalculatorAiAdviceResponse } from './leverage-calculator-ai.types';
import {
  formatRubAmount,
  loanFieldUsd,
  type RubUsdRateResponse,
} from './leverage-calculator-fx.util';
import {
  buildMonthlyCapitalTrajectory,
  buildMonthlyCapitalTrajectoryEarly,
  computeContractEndDate,
  computeLeverageOutlook,
  computeLeverageStrategyHints,
  equityOnlyCapitalAtMonth,
  formatDateRuLong,
  formatMonths,
  formatPercentRate,
  formatUsdSigned,
  parseIsoDateOnly,
  todayIsoDateOnly,
} from './leverage-calculator-page.util';

export type { LeverageCalculatorPayload } from './leverage-calculator-page.types';

type SaveState = 'idle' | 'saving' | 'saved' | 'err';

/** Порог USDT: ниже по модулю считаем «около нуля» для вердикта в карточке. */
const LEVERAGE_VERDICT_EPS_USD = 5;

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
  const [loanPaymentTiming, setLoanPaymentTiming] = useState<LeverageLoanPaymentTiming>(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return p.loanPaymentTiming;
  });
  const [loanStartIso, setLoanStartIso] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    const s = String(p.loanStartIso ?? '').trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : todayIsoDateOnly();
  });
  const [earlyPayoffEnabled, setEarlyPayoffEnabled] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return p.earlyPayoffEnabled === true;
  });
  const [earlyPayoffAfterMonth, setEarlyPayoffAfterMonth] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return String(p.earlyPayoffAfterMonth ?? 6);
  });
  const [earlyCloseoutUsd, setEarlyCloseoutUsd] = useState(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return String(p.earlyCloseoutUsd ?? 0);
  });
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [aiUserComment, setAiUserComment] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<LeverageCalculatorAiAdviceResponse | null>(null);
  const [rubPerUsd, setRubPerUsd] = useState<number | null>(null);
  const [fxStatus, setFxStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle');
  const [fxDate, setFxDate] = useState<string | null>(null);
  const [inputCurrency, setInputCurrency] = useState<LeverageInputCurrency>(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    return p.inputCurrency;
  });
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipPersistOnce = useRef(true);

  useEffect(() => {
    const p = parseLeveragePresetJson(initialPresetJson) ?? DEFAULT_LEVERAGE_PRESET;
    const want: LeverageInputCurrency = p.inputCurrency === 'RUB' ? 'RUB' : 'USD';
    const effective: LeverageInputCurrency =
      want === 'RUB' && (rubPerUsd == null || rubPerUsd <= 0) ? 'USD' : want;
    setInputCurrency(effective);
    setTermYears(String(p.termYears));
    setHorizonAfter(String(p.horizonMonthsAfterLoan));
    setMode(p.mode);
    setLoanPaymentTiming(p.loanPaymentTiming);
    setLoanStartIso(
      /^\d{4}-\d{2}-\d{2}$/.test(String(p.loanStartIso ?? '').trim())
        ? String(p.loanStartIso).trim()
        : todayIsoDateOnly(),
    );
    setEarlyPayoffEnabled(p.earlyPayoffEnabled === true);
    setEarlyPayoffAfterMonth(String(p.earlyPayoffAfterMonth ?? 6));

    if (effective === 'RUB' && rubPerUsd != null && rubPerUsd > 0) {
      setPrincipal(String(Math.round(p.principalUsd * rubPerUsd)));
      setMonthly(String(Math.round(p.monthlyPaymentUsd * rubPerUsd)));
      setEarlyCloseoutUsd(String(Math.round((p.earlyCloseoutUsd ?? 0) * rubPerUsd)));
    } else {
      setPrincipal(String(p.principalUsd));
      setMonthly(String(p.monthlyPaymentUsd));
      setEarlyCloseoutUsd(String(p.earlyCloseoutUsd ?? 0));
    }
    skipPersistOnce.current = true;
  }, [initialPresetJson, rubPerUsd]);

  useEffect(() => {
    let alive = true;
    setFxStatus('loading');
    void fetch(withAppBasePath('/api/fx/rub-usd'))
      .then((r) => r.json() as Promise<RubUsdRateResponse>)
      .then((j) => {
        if (!alive) return;
        if (j.ok && typeof j.rubPerUsd === 'number' && j.rubPerUsd > 0) {
          setRubPerUsd(j.rubPerUsd);
          setFxDate(j.date ?? null);
          setFxStatus('ok');
        } else {
          setRubPerUsd(null);
          setFxDate(null);
          setFxStatus('err');
        }
      })
      .catch(() => {
        if (!alive) return;
        setRubPerUsd(null);
        setFxDate(null);
        setFxStatus('err');
      });
    return () => {
      alive = false;
    };
  }, []);

  const rubPerUsdSafe = rubPerUsd != null && rubPerUsd > 0 ? rubPerUsd : null;

  const equityNum = payload.equityUsd != null && payload.equityUsd > 0 ? payload.equityUsd : 0;

  const loan = useMemo(() => {
    const L = loanFieldUsd(principal, inputCurrency, rubPerUsdSafe);
    const M = loanFieldUsd(monthly, inputCurrency, rubPerUsdSafe);
    const y = Number.parseFloat(termYears.replace(',', '.')) || 0;
    const termMonths = Math.max(0, Math.round(y * 12));
    return { principalUsd: L, monthlyPaymentUsd: M, termMonths };
  }, [principal, monthly, termYears, inputCurrency, rubPerUsdSafe]);

  const horizonMonthsAfterLoan = useMemo(() => {
    const h = Number.parseInt(horizonAfter, 10);
    return Number.isFinite(h) ? Math.max(0, h) : 0;
  }, [horizonAfter]);

  const earlyPayoffForOutlook = useMemo(() => {
    if (!earlyPayoffEnabled) return null;
    const termM = loan.termMonths;
    if (termM < 2) return null;
    const kRaw = Number.parseInt(earlyPayoffAfterMonth, 10);
    const k = Number.isFinite(kRaw)
      ? Math.min(Math.max(1, kRaw), termM - 1)
      : Math.min(6, termM - 1);
    const co = loanFieldUsd(earlyCloseoutUsd, inputCurrency, rubPerUsdSafe);
    return { closeAfterMonth: k, closeoutUsd: co };
  }, [
    earlyPayoffEnabled,
    earlyPayoffAfterMonth,
    earlyCloseoutUsd,
    loan.termMonths,
    inputCurrency,
    rubPerUsdSafe,
  ]);

  const outlook = useMemo(() => {
    if (equityNum <= 0) return null;
    return computeLeverageOutlook({
      equityUsd: equityNum,
      expectedPnlPerDayUsd: payload.expectedPnlPerDayUsd,
      realizedPnlPerDayUsd: payload.realizedPnlPerDayUsd,
      mode,
      loan,
      horizonMonthsAfterLoan,
      earlyPayoff: earlyPayoffForOutlook,
      loanPaymentTiming,
    });
  }, [
    equityNum,
    payload.expectedPnlPerDayUsd,
    payload.realizedPnlPerDayUsd,
    mode,
    loan,
    horizonMonthsAfterLoan,
    earlyPayoffForOutlook,
    loanPaymentTiming,
  ]);

  const strategyHints = useMemo(() => (outlook ? computeLeverageStrategyHints(outlook) : []), [outlook]);

  const leverageBorrowVerdict = useMemo(() => {
    if (!outlook) return null;
    const dh = outlook.deltaHorizonVsEquityOnlyUsd;
    const da = outlook.deltaAfterLoanVsEquityOnlyUsd;
    if (dh == null && da == null) {
      return {
        tone: 'neutral' as const,
        lead: 'Сравнение с «только E» при текущих параметрах не выводится — проверьте срок кредита, платежи и блок предупреждений ниже.',
        horizonDelta: null as number | null,
        subParts: [] as string[],
      };
    }

    let tone: 'win' | 'lose' | 'neutral' = 'neutral';
    let lead: string;

    if (dh == null || !Number.isFinite(dh)) {
      lead = 'Недостаточно данных, чтобы сравнить займ с ростом только на своих средствах на полном горизонте.';
    } else if (dh > LEVERAGE_VERDICT_EPS_USD) {
      tone = 'win';
      lead = 'По модели займ увеличивает капитал относительно сценария без заёмных средств (тот же r, только E).';
    } else if (dh < -LEVERAGE_VERDICT_EPS_USD) {
      tone = 'lose';
      lead = 'По модели «только свой E» даёт больший капитал на горизонте — займ съедается выплатами относительно этой оценки.';
    } else {
      lead = 'На полном горизонте симуляции займ и «только E» почти совпадают по капиталу (разница в пределах погрешности модели).';
    }

    const subParts: string[] = [];
    const rub = rubPerUsdSafe;
    const rubNote = (usd: number) =>
      rub != null && Number.isFinite(usd) ? ` (~ ${formatRubAmount(usd * rub)})` : '';
    if (da != null && Number.isFinite(da)) {
      subParts.push(
        `После последнего месяца кредита по графику: ${formatUsdSigned(da)}${rubNote(da)} к «только E» на тот же месяц.`,
      );
    }
    if (outlook.earlyPayoffComparable) {
      if (
        outlook.capitalHorizonEarlyVsStandardUsd != null &&
        Number.isFinite(outlook.capitalHorizonEarlyVsStandardUsd)
      ) {
        const v = outlook.capitalHorizonEarlyVsStandardUsd;
        subParts.push(
          `Досрочное vs полный график на горизонте: ${formatUsdSigned(v)}${rubNote(v)} к капиталу.`,
        );
      }
      if (
        outlook.bankCashflowSavingsVsFullScheduleUsd != null &&
        Number.isFinite(outlook.bankCashflowSavingsVsFullScheduleUsd)
      ) {
        const v = outlook.bankCashflowSavingsVsFullScheduleUsd;
        subParts.push(
          `Выплаты банку: ${formatUsdSigned(v)}${rubNote(v)} к сумме всех M по сроку (досрочный сценарий).`,
        );
      }
    }

    return {
      tone,
      lead,
      horizonDelta: dh,
      subParts,
    };
  }, [outlook, rubPerUsdSafe]);

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
      loanPaymentTiming,
    });
  }, [equityNum, rDaily, loan, horizonMonthsAfterLoan, loanPaymentTiming]);

  const trajectoryEarly = useMemo(() => {
    if (
      equityNum <= 0 ||
      rDaily == null ||
      !Number.isFinite(rDaily) ||
      rDaily <= -1 ||
      !earlyPayoffForOutlook ||
      earlyPayoffForOutlook.closeoutUsd <= 0
    ) {
      return null;
    }
    const termM = loan.termMonths;
    if (termM < 2) return null;
    const k = earlyPayoffForOutlook.closeAfterMonth;
    if (k < 1 || k >= termM) return null;
    return buildMonthlyCapitalTrajectoryEarly({
      equityUsd: equityNum,
      loanPrincipalUsd: loan.principalUsd,
      monthlyPaymentUsd: loan.monthlyPaymentUsd,
      termMonths: termM,
      horizonMonthsAfter: horizonMonthsAfterLoan,
      rDaily,
      early: earlyPayoffForOutlook,
      loanPaymentTiming,
    });
  }, [equityNum, rDaily, loan, horizonMonthsAfterLoan, earlyPayoffForOutlook, loanPaymentTiming]);

  const trajectoryWithCompare = useMemo(() => {
    if (trajectory.length === 0 || rDaily == null || !Number.isFinite(rDaily) || rDaily <= -1) {
      return [];
    }
    return trajectory.map((p, i) => {
      const v = equityOnlyCapitalAtMonth(equityNum, rDaily, p.month);
      const ear = trajectoryEarly?.[i];
      return {
        ...p,
        equityOnlyCapitalUsd: Number.isFinite(v) ? v : 0,
        capitalEarlyUsd: ear?.capitalUsd,
        cumulativePaidEarlyUsd: ear?.cumulativePaidUsd,
      };
    });
  }, [trajectory, trajectoryEarly, equityNum, rDaily]);

  const earlyCloseMonthForChart =
    outlook?.earlyPayoffComparable && earlyPayoffForOutlook
      ? earlyPayoffForOutlook.closeAfterMonth
      : null;

  const loanStartDate = useMemo(() => parseIsoDateOnly(loanStartIso) ?? new Date(), [loanStartIso]);
  const contractEndDate = useMemo(
    () => computeContractEndDate(loanStartDate, loan.termMonths),
    [loanStartDate, loan.termMonths],
  );
  const contractEndLabel = useMemo(() => formatDateRuLong(contractEndDate), [contractEndDate]);
  const earlyContractEndDate = useMemo(() => {
    if (!earlyPayoffForOutlook || loan.termMonths < 2) return null;
    return computeContractEndDate(loanStartDate, earlyPayoffForOutlook.closeAfterMonth);
  }, [loanStartDate, loan.termMonths, earlyPayoffForOutlook]);
  const earlyContractEndLabel = useMemo(
    () => (earlyContractEndDate ? formatDateRuLong(earlyContractEndDate) : null),
    [earlyContractEndDate],
  );

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

  const runLeverageAi = useCallback(async () => {
    if (!outlook) return;
    setAiLoading(true);
    setAiResult(null);
    try {
      const body = buildLeverageAiAdviceRequest({
        mode,
        horizonMonthsAfterLoan,
        loan,
        earlyPayoffEnabled,
        earlyPayoffForOutlook: earlyPayoffEnabled ? earlyPayoffForOutlook : null,
        payload,
        outlook,
        verdict: leverageBorrowVerdict
          ? { tone: leverageBorrowVerdict.tone, lead: leverageBorrowVerdict.lead }
          : null,
        hints: strategyHints,
        warnings: outlook.warnings,
        userComment: aiUserComment,
      });
      const res = await fetchJson<LeverageCalculatorAiAdviceResponse>(
        '/orders/leverage-calculator-ai-advice',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
        cabinetIdForApi,
      );
      setAiResult(res);
    } catch (e) {
      setAiResult({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAiLoading(false);
    }
  }, [
    outlook,
    mode,
    horizonMonthsAfterLoan,
    loan,
    earlyPayoffEnabled,
    earlyPayoffForOutlook,
    payload,
    leverageBorrowVerdict,
    strategyHints,
    aiUserComment,
    cabinetIdForApi,
  ]);

  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (skipPersistOnce.current) {
        skipPersistOnce.current = false;
        return;
      }
      const preset = buildPresetFromFormState({
        principalUsd: loanFieldUsd(principal, inputCurrency, rubPerUsdSafe),
        monthlyPaymentUsd: loanFieldUsd(monthly, inputCurrency, rubPerUsdSafe),
        termYears: Number.parseFloat(termYears.replace(',', '.')) || 0,
        horizonMonthsAfterLoan: Number.parseInt(horizonAfter, 10) || 0,
        mode,
        loanPaymentTiming,
        inputCurrency,
        loanStartIso,
        earlyPayoffEnabled,
        earlyPayoffAfterMonth: Number.parseInt(earlyPayoffAfterMonth, 10) || 1,
        earlyCloseoutUsd: loanFieldUsd(earlyCloseoutUsd, inputCurrency, rubPerUsdSafe),
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
  }, [
    principal,
    monthly,
    termYears,
    horizonAfter,
    mode,
    loanPaymentTiming,
    loanStartIso,
    earlyPayoffEnabled,
    earlyPayoffAfterMonth,
    earlyCloseoutUsd,
    inputCurrency,
    rubPerUsdSafe,
    persistPreset,
  ]);

  const commitInputCurrency = useCallback(
    (next: LeverageInputCurrency) => {
      if (next === inputCurrency) return;
      if (rubPerUsdSafe == null) return;
      if (next === 'RUB') {
        setPrincipal(String(Math.round(loanFieldUsd(principal, 'USD', null) * rubPerUsdSafe)));
        setMonthly(String(Math.round(loanFieldUsd(monthly, 'USD', null) * rubPerUsdSafe)));
        setEarlyCloseoutUsd(String(Math.round(loanFieldUsd(earlyCloseoutUsd, 'USD', null) * rubPerUsdSafe)));
      } else {
        setPrincipal(String(loanFieldUsd(principal, 'RUB', rubPerUsdSafe).toFixed(2)));
        setMonthly(String(loanFieldUsd(monthly, 'RUB', rubPerUsdSafe).toFixed(2)));
        setEarlyCloseoutUsd(String(loanFieldUsd(earlyCloseoutUsd, 'RUB', rubPerUsdSafe).toFixed(2)));
      }
      setInputCurrency(next);
    },
    [inputCurrency, rubPerUsdSafe, principal, monthly, earlyCloseoutUsd],
  );

  const moneyUnit = inputCurrency === 'RUB' ? '₽' : 'USDT';

  return (
    <div className="leveragePage">
      <header className="leverageHero">
        <div>
          <h1 className="leverageTitle">Кредит и доходность по всем кабинетам</h1>
          <p className="leverageLead">
            Сводка с дашборда: суммарный equity, ожидаемый и грубо реализованный PnL в день. Займ
            добавляется к торговому счёту (C₀ = E + L); платёж M каждый месяц списывается с того же
            остатка, а не «снаружи». Ниже — календарь договора, потоки, сравнение с ростом только на E и
            график капитала.
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
          <strong className="leverageKpiValue">
            <DualUsdRub usd={payload.equityUsd} rubPerUsd={rubPerUsdSafe} />
          </strong>
        </article>
        <article className="leverageKpi">
          <span className="leverageKpiLabel">Ожидаемый PnL / день</span>
          <strong className="leverageKpiValue">
            <DualUsdRub usd={payload.expectedPnlPerDayUsd} rubPerUsd={rubPerUsdSafe} usdDigits={4} />
          </strong>
        </article>
        <article className="leverageKpi">
          <span className="leverageKpiLabel">Реализ. PnL / день (оценка)</span>
          <strong className="leverageKpiValue">
            <DualUsdRub usd={payload.realizedPnlPerDayUsd} rubPerUsd={rubPerUsdSafe} usdDigits={4} />
          </strong>
        </article>
      </section>

      <div className="leverageGrid">
        <section className="card leveragePanel">
          <h2 className="leverageSectionTitle">Параметры кредита</h2>
          <p className="leverageMuted">
            Значения пишутся в настройку аккаунта <code>{LEVERAGE_CALCULATOR_PRESET_KEY}</code> и
            подставляются при следующем визите. Суммы кредита в БД сохраняются в USDT; при вводе в ₽ они
            переводятся по курсу ЦБ РФ для расчётов.
          </p>
          <p className="leverageMuted" style={{ marginTop: '0.35rem' }}>
            {fxStatus === 'loading' ? 'Загрузка курса USD (ЦБ РФ, cbr-xml-daily.ru)…' : null}
            {fxStatus === 'ok' && rubPerUsdSafe != null ? (
              <>
                Справочно: 1 USD = {rubPerUsdSafe.toLocaleString('ru-RU', { maximumFractionDigits: 4 })} ₽
                {fxDate ? ` (дата курса ${fxDate})` : ''}.
              </>
            ) : null}
            {fxStatus === 'err' ? (
              <>Не удалось получить курс ЦБ — доступен только ввод сумм кредита в USDT.</>
            ) : null}
          </p>
          <fieldset className="leverageModeFieldset" style={{ marginTop: '0.5rem' }}>
            <legend>Валюта ввода сумм кредита</legend>
            <label>
              <input
                type="radio"
                name="lev-input-ccy"
                checked={inputCurrency === 'USD'}
                onChange={() => commitInputCurrency('USD')}
              />{' '}
              USDT (как на счёте Bybit)
            </label>
            <label>
              <input
                type="radio"
                name="lev-input-ccy"
                checked={inputCurrency === 'RUB'}
                onChange={() => commitInputCurrency('RUB')}
                disabled={rubPerUsdSafe == null}
              />{' '}
              ₽ (пересчёт в USDT по курсу ЦБ)
            </label>
          </fieldset>
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
              <span className="leverageFieldLabel">Сумма кредита, {moneyUnit}</span>
              <input
                type="text"
                inputMode="decimal"
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
            </label>
            <label>
              <span className="leverageFieldLabel">Платёж в месяц, {moneyUnit}</span>
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
          <fieldset className="leverageModeFieldset" style={{ marginTop: '1rem' }}>
            <legend>Порядок месяца: платёж M и доходность на едином счёте</legend>
            <label>
              <input
                type="radio"
                name="lev-loan-timing"
                checked={loanPaymentTiming === 'after_monthly_return'}
                onChange={() => setLoanPaymentTiming('after_monthly_return')}
              />{' '}
              Сначала рост на весь остаток месяца, затем M (типично: M с итога на счёте)
            </label>
            <label>
              <input
                type="radio"
                name="lev-loan-timing"
                checked={loanPaymentTiming === 'before_monthly_return'}
                onChange={() => setLoanPaymentTiming('before_monthly_return')}
              />{' '}
              Сначала M, затем рост на остаток (консервативнее, если списание в начале периода)
            </label>
            <p className="leverageMuted" style={{ marginTop: '0.65rem', marginBottom: 0 }}>
              Пример: E = 100, L = 1000 → на старте C = 1100; каждый месяц с этого же C уходит M (как
              погашение с торгового баланса).
            </p>
          </fieldset>
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
          <fieldset className="leverageModeFieldset" style={{ marginTop: '1rem' }}>
            <legend>Досрочное погашение (сравнение сценариев)</legend>
            <label style={{ display: 'block', marginBottom: '0.5rem' }}>
              <input
                type="checkbox"
                checked={earlyPayoffEnabled}
                onChange={(e) => setEarlyPayoffEnabled(e.target.checked)}
              />{' '}
              Считать сценарий с досрочным закрытием
            </label>
            <div
              className="settingsForm leverageFormGrid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
                gap: '0.85rem',
                alignItems: 'end',
                opacity: earlyPayoffEnabled ? 1 : 0.55,
                pointerEvents: earlyPayoffEnabled ? 'auto' : 'none',
              }}
            >
              <label>
                <span className="leverageFieldLabel">Закрыть долг после месяца № (1…T−1)</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={earlyPayoffAfterMonth}
                  onChange={(e) => setEarlyPayoffAfterMonth(e.target.value)}
                />
              </label>
              <label>
                <span className="leverageFieldLabel">Разовый платёж при закрытии (остаток + комиссии), {moneyUnit}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={earlyCloseoutUsd}
                  onChange={(e) => setEarlyCloseoutUsd(e.target.value)}
                />
              </label>
            </div>
            <p className="leverageMuted" style={{ marginTop: '0.65rem', marginBottom: 0 }}>
              В конце выбранного месяца модель списывает обычный M и дополнительно разовую сумму
              (как в справке банка по остатку); дальше платежей нет до конца договорного срока — капитал
              только растёт при том же r.
            </p>
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
              {loan.termMonths > 0 && loan.monthlyPaymentUsd > 0 ? (
                <DualUsdRub usd={loan.monthlyPaymentUsd * loan.termMonths} rubPerUsd={rubPerUsdSafe} />
              ) : (
                '—'
              )}
            </li>
            <li>
              <strong>Тело кредита:</strong>{' '}
              <DualUsdRub usd={loan.principalUsd} rubPerUsd={rubPerUsdSafe} />
            </li>
            {earlyPayoffEnabled && earlyContractEndLabel && loan.termMonths >= 2 ? (
              <li>
                <strong>Дата досрочного закрытия (модель):</strong> {earlyContractEndLabel}
              </li>
            ) : null}
          </ul>
          {equityNum > 0 && outlook && leverageBorrowVerdict ? (
            <div className="leverageVerdict" data-tone={leverageBorrowVerdict.tone}>
              <div className="leverageVerdictTitle">Займ vs только свой капитал</div>
              <p className="leverageVerdictLead">{leverageBorrowVerdict.lead}</p>
              {leverageBorrowVerdict.horizonDelta != null &&
              Number.isFinite(leverageBorrowVerdict.horizonDelta) ? (
                <>
                  <p className="leverageVerdictFigure">
                    <DualUsdRubSigned usd={leverageBorrowVerdict.horizonDelta} rubPerUsd={rubPerUsdSafe} />
                  </p>
                  <p className="leverageVerdictCaption">
                    Разница капитала на полном горизонте симуляции (со займом по графику минус только E,
                    тот же r).
                  </p>
                </>
              ) : null}
              {leverageBorrowVerdict.subParts.length > 0 ? (
                <div className="leverageVerdictSub">
                  {leverageBorrowVerdict.subParts.map((line, idx) => (
                    <p key={idx} style={{ margin: idx > 0 ? '0.45rem 0 0' : 0 }}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : equityNum <= 0 ? (
            <div className="leverageVerdict" data-tone="neutral">
              <div className="leverageVerdictTitle">Займ vs только свой капитал</div>
              <p className="leverageVerdictLead">
                Нет суммарного equity — сравнение с сценарием «только E» недоступно.
              </p>
            </div>
          ) : null}
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
            {outlook.warnings.map((w, i) => (
              <p key={`${i}-${w.slice(0, 40)}`} className="msg err" style={{ margin: '0.35rem 0' }}>
                {w}
              </p>
            ))}
            <p className="leverageMuted" style={{ margin: '0.5rem 0 0.85rem' }}>
              Ставка по кредиту — обратный расчёт из введённых L, M и срока T (месяцев), если платёж
              соответствует классическому аннуитету; при другой схеме договора цифра может не совпадать с
              банком.
            </p>
            <div className="leverageMetricsGrid">
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Капитал с займом (E + L)</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.capitalWithLoanUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Доходность r (оценка)</span>
                <span className="leverageMetricVal">
                  {outlook.rDaily != null ? `${(outlook.rDaily * 100).toFixed(4)}% / день` : '—'}
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Валовый PnL, 1-й месяц (дискретно)</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.grossMonthlyStartUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Чистый прирост за 1-й месяц (как в симуляции)</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.netMonthlyStartUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Точка безубыточности капитала C*</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.breakEvenCapitalUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Запас до C* (C₀ − C*)</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.surplusVsBreakEvenUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Переплата (выплаты − тело)</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.overpaymentUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Ставка по кредиту, месячная i (аннуитет L, M, T)</span>
                <span className="leverageMetricVal">{formatPercentRate(outlook.loanImpliedMonthlyRate)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Годовых номинальных (12·i)</span>
                <span className="leverageMetricVal">{formatPercentRate(outlook.loanNominalApr)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Годовых эффективных ((1+i)¹²−1)</span>
                <span className="leverageMetricVal">{formatPercentRate(outlook.loanEffectiveAnnualRate)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Окупаемость переплаты (линейно)</span>
                <span className="leverageMetricVal">{formatMonths(outlook.monthsToRecoverOverpayment)}</span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Капитал после срока кредита</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.capitalAfterLoanUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Через {horizonMonthsAfterLoan} мес. после кредита</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.capitalAfterHorizonUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Только E: после срока кредита (без займа)</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.equityOnlyAfterLoanUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Только E: на полном горизонте симуляции</span>
                <span className="leverageMetricVal">
                  <DualUsdRub usd={outlook.equityOnlyAfterHorizonUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Разница после кредита (со займом − только E)</span>
                <span className="leverageMetricVal">
                  <DualUsdRubSigned usd={outlook.deltaAfterLoanVsEquityOnlyUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
              <div className="leverageMetric">
                <span className="leverageMetricLabel">Разница на полном горизонте</span>
                <span className="leverageMetricVal">
                  <DualUsdRubSigned usd={outlook.deltaHorizonVsEquityOnlyUsd} rubPerUsd={rubPerUsdSafe} />
                </span>
              </div>
            </div>
            {outlook.earlyPayoffComparable ? (
              <>
                <h3 className="leverageSectionTitle" style={{ marginTop: '1.35rem', fontSize: '1.05rem' }}>
                  Досрочное vs полный график
                </h3>
                <div className="leverageMetricsGrid">
                  <div className="leverageMetric">
                    <span className="leverageMetricLabel">Выплачено банку при досрочном</span>
                    <span className="leverageMetricVal">
                      <DualUsdRub usd={outlook.totalPaidEarlyUsd} rubPerUsd={rubPerUsdSafe} />
                    </span>
                  </div>
                  <div className="leverageMetric">
                    <span className="leverageMetricLabel">Экономия vs M·T (полный график)</span>
                    <span className="leverageMetricVal">
                      <DualUsdRubSigned
                        usd={outlook.bankCashflowSavingsVsFullScheduleUsd}
                        rubPerUsd={rubPerUsdSafe}
                      />
                    </span>
                  </div>
                  <div className="leverageMetric">
                    <span className="leverageMetricLabel">M·(T−k) − разовый платёж (грубая оценка)</span>
                    <span className="leverageMetricVal">
                      <DualUsdRubSigned usd={outlook.earlyCloseoutVsAnnuityTailUsd} rubPerUsd={rubPerUsdSafe} />
                    </span>
                  </div>
                  <div className="leverageMetric">
                    <span className="leverageMetricLabel">Капитал на горизонте: досрочно − по графику</span>
                    <span className="leverageMetricVal">
                      <DualUsdRubSigned
                        usd={outlook.capitalHorizonEarlyVsStandardUsd}
                        rubPerUsd={rubPerUsdSafe}
                      />
                    </span>
                  </div>
                  <div className="leverageMetric">
                    <span className="leverageMetricLabel">Капитал на горизонте (досрочно)</span>
                    <span className="leverageMetricVal">
                      <DualUsdRub usd={outlook.capitalAfterHorizonEarlyUsd} rubPerUsd={rubPerUsdSafe} />
                    </span>
                  </div>
                </div>
                <p className="leverageFootnote" style={{ marginTop: '0.65rem' }}>
                  Положительная «экономия vs M·T» означает, что суммарно банку отдали меньше, чем при всех
                  платежах по сроку. Строка M·(T−k) − closeout сравнивает разовый выход с суммой
                  оставшихся аннуитетных M без учёта дисконтирования — для решения о досрочном ориентируйтесь
                  на цифры из договора.
                </p>
              </>
            ) : null}
            {strategyHints.length > 0 ? (
              <div style={{ marginTop: '1.25rem' }}>
                <h3 className="leverageSectionTitle" style={{ fontSize: '1.05rem' }}>
                  Подсказки по модели (не финсовет)
                </h3>
                <ul className="leverageFactList" style={{ marginTop: '0.5rem' }}>
                  {strategyHints.map((h, idx) => (
                    <li key={idx}>{h}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="leverageFootnote" style={{ marginTop: '0.75rem' }}>
              «Только E» — тот же коэффициент r, но стартовый капитал равен equity без привлечения L и
              без ежемесячных платежей M: чистый контрольный сценарий «остаться на своих» при той же
              оценке доходности.
            </p>
            <p className="leverageFootnote" style={{ marginTop: '1.25rem' }}>
              Модель: каждый месяц капитал × (1 + r)³⁰ минус платёж; r не меняется. Реальность:
              просадки, комиссии, изменение объёма позиций и условия банка — не учитываются.
            </p>
          </section>

          <section className="card leverageSpaced">
            <h2 className="leverageSectionTitle">
              График: по графику, досрочно (если задано), только E и выплаты
            </h2>
            <LeverageCalculatorCharts
              data={trajectoryWithCompare}
              termMonths={loan.termMonths}
              earlyCloseMonth={earlyCloseMonthForChart}
              rubPerUsd={rubPerUsdSafe}
            />
          </section>

          <section className="card leverageSpaced leverageAiPanel">
            <h2 className="leverageSectionTitle">Рекомендации ИИ</h2>
            <p className="leverageMuted">
              В запрос уходит текущий снимок полей и расчётов страницы. Нужны ключ и модель OpenRouter в
              настройках: <code>OPENROUTER_API_KEY</code>, приоритетно{' '}
              <code>OPENROUTER_MODEL_AI_ADVISOR</code>, иначе <code>OPENROUTER_MODEL_TEXT</code> /{' '}
              <code>OPENROUTER_MODEL_DEFAULT</code>.
            </p>
            <label style={{ display: 'block', marginTop: '0.85rem' }}>
              <span className="leverageFieldLabel">Комментарий для ИИ (необязательно)</span>
              <textarea
                className="leverageAiTextarea"
                rows={3}
                maxLength={800}
                value={aiUserComment}
                onChange={(e) => setAiUserComment(e.target.value)}
                placeholder="Например: планирую досрочное через полгода, какие риски?"
              />
            </label>
            <div style={{ marginTop: '0.85rem' }}>
              <button
                type="button"
                className="btn"
                onClick={() => void runLeverageAi()}
                disabled={aiLoading}
              >
                {aiLoading ? 'ИИ отвечает…' : 'Получить рекомендации ИИ'}
              </button>
            </div>
            {aiResult && !aiResult.ok ? (
              <p className="msg err" style={{ marginTop: '0.85rem' }}>
                {aiResult.error}
              </p>
            ) : null}
            {aiResult?.ok ? (
              <div className="leverageAiResult" style={{ marginTop: '1rem' }}>
                <p style={{ margin: 0, lineHeight: 1.55, fontSize: '0.98rem' }}>{aiResult.summary}</p>
                <ul className="leverageFactList" style={{ marginTop: '0.75rem' }}>
                  {aiResult.points.map((pt, idx) => (
                    <li key={idx}>{pt}</li>
                  ))}
                </ul>
                <p className="leverageFootnote" style={{ marginTop: '0.85rem' }}>
                  {aiResult.disclaimer}
                </p>
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
