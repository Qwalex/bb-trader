/**
 * Модель: дневная доходность r = G/E (как блок «перспектива» на главной),
 * G — выбранная база (ожидаемый PnL/день по EV или реализованный / max(period)).
 * После привлечения займа капитал C₀ = E + L, валовый PnL/день масштабируется: G×(C/E).
 */

export type LeverageCalcMode = 'expected' | 'realized';

export type LeverageLoanParams = {
  principalUsd: number;
  monthlyPaymentUsd: number;
  termMonths: number;
};

export type LeverageOutlook = {
  mode: LeverageCalcMode;
  /** G или R — выбранная база USDT/день при капитале E. */
  basePnlPerDayUsd: number | null;
  rDaily: number | null;
  equityUsd: number;
  loanPrincipalUsd: number;
  capitalWithLoanUsd: number;
  grossDailyStartUsd: number | null;
  grossMonthlyStartUsd: number | null;
  netMonthlyStartUsd: number | null;
  dailyLoanBurdenUsd: number;
  /** Капитал C, при котором 30×(G/E)×C = M (месячный валовой = платёж). */
  breakEvenCapitalUsd: number | null;
  /** На сколько текущий C₀ выше/ниже точки безубыточности (C₀ − C_be). */
  surplusVsBreakEvenUsd: number | null;
  totalPaidUsd: number;
  overpaymentUsd: number;
  /** Срок окупаемости переплаты по кредиту при стартовом чистом месячном потоке. */
  monthsToRecoverOverpayment: number | null;
  /** Остаток капитала после месячной симуляции с платежом M. */
  capitalAfterLoanUsd: number | null;
  /** Горизонт после кредита: capitalAfter × (1+r)^30n без платежа. */
  capitalAfterHorizonUsd: number | null;
  wentNegativeDuringLoan: boolean;
  warnings: string[];
};

const DAYS_PER_MONTH = 30;

export function monthGrowthFactorFromRDaily(rDaily: number): number {
  return Math.pow(1 + rDaily, DAYS_PER_MONTH);
}

function pickBasePnlPerDay(
  mode: LeverageCalcMode,
  expected: number | null | undefined,
  realized: number | null | undefined,
): number | null {
  if (mode === 'realized') {
    const r = realized != null && Number.isFinite(realized) ? realized : null;
    if (r != null && r !== 0) return r;
    const e = expected != null && Number.isFinite(expected) ? expected : null;
    return e;
  }
  const e = expected != null && Number.isFinite(expected) ? expected : null;
  if (e != null) return e;
  const r = realized != null && Number.isFinite(realized) ? realized : null;
  return r;
}

export function computeLeverageOutlook(params: {
  equityUsd: number;
  expectedPnlPerDayUsd: number | null | undefined;
  realizedPnlPerDayUsd: number | null | undefined;
  mode: LeverageCalcMode;
  loan: LeverageLoanParams;
  /** Месяцев после последнего платежа по кредиту — «перспектива». */
  horizonMonthsAfterLoan: number;
}): LeverageOutlook {
  const warnings: string[] = [];
  const { mode, loan } = params;
  const E = Number.isFinite(params.equityUsd) ? Math.max(0, params.equityUsd) : 0;
  const L = Number.isFinite(loan.principalUsd) ? Math.max(0, loan.principalUsd) : 0;
  const M = Number.isFinite(loan.monthlyPaymentUsd) ? Math.max(0, loan.monthlyPaymentUsd) : 0;
  const termM = Math.max(0, Math.floor(Number.isFinite(loan.termMonths) ? loan.termMonths : 0));
  const horizonAfter = Math.max(
    0,
    Math.floor(
      Number.isFinite(params.horizonMonthsAfterLoan) ? params.horizonMonthsAfterLoan : 0,
    ),
  );

  const basePnlPerDayUsd = pickBasePnlPerDay(
    mode,
    params.expectedPnlPerDayUsd,
    params.realizedPnlPerDayUsd,
  );

  if (E <= 0) {
    warnings.push('Суммарный equity по кабинетам равен нулю или неизвестен — масштабирование от капитала невозможно.');
  }
  if (basePnlPerDayUsd == null || !Number.isFinite(basePnlPerDayUsd)) {
    warnings.push('Нет данных для оценки дневной доходности (ожидаемой или реализованной).');
  }
  if (L <= 0) {
    warnings.push('Сумма кредита должна быть больше нуля.');
  }
  if (M <= 0) {
    warnings.push('Ежемесячный платёж должен быть больше нуля.');
  }
  if (termM <= 0) {
    warnings.push('Срок кредита (месяцев) должен быть больше нуля.');
  }

  const rDaily =
    E > 0 && basePnlPerDayUsd != null && Number.isFinite(basePnlPerDayUsd)
      ? basePnlPerDayUsd / E
      : null;

  if (rDaily != null && rDaily <= -1) {
    warnings.push('Модель даёт некорректный множитель роста (r ≤ −1).');
  }

  const C0 = E + L;
  const grossDailyStartUsd =
    E > 0 && basePnlPerDayUsd != null && Number.isFinite(basePnlPerDayUsd)
      ? (basePnlPerDayUsd * C0) / E
      : null;
  const grossMonthlyStartUsd =
    grossDailyStartUsd != null ? grossDailyStartUsd * DAYS_PER_MONTH : null;
  const netMonthlyStartUsd =
    grossMonthlyStartUsd != null ? grossMonthlyStartUsd - M : null;

  const dailyLoanBurdenUsd = M > 0 ? M / DAYS_PER_MONTH : 0;

  let breakEvenCapitalUsd: number | null = null;
  if (M > 0 && E > 0 && basePnlPerDayUsd != null && Math.abs(basePnlPerDayUsd) > 1e-12) {
    breakEvenCapitalUsd = (M * E) / (DAYS_PER_MONTH * basePnlPerDayUsd);
  }

  let surplusVsBreakEvenUsd: number | null = null;
  if (breakEvenCapitalUsd != null && Number.isFinite(breakEvenCapitalUsd)) {
    surplusVsBreakEvenUsd = C0 - breakEvenCapitalUsd;
  }

  const totalPaidUsd = M * termM;
  const overpaymentUsd = totalPaidUsd - L;

  let monthsToRecoverOverpayment: number | null = null;
  if (overpaymentUsd > 0 && netMonthlyStartUsd != null && netMonthlyStartUsd > 1e-6) {
    monthsToRecoverOverpayment = Math.ceil(overpaymentUsd / netMonthlyStartUsd);
  } else if (overpaymentUsd > 0 && (netMonthlyStartUsd == null || netMonthlyStartUsd <= 0)) {
    monthsToRecoverOverpayment = null;
    if (netMonthlyStartUsd != null && netMonthlyStartUsd <= 0) {
      warnings.push(
        'При стартовых параметрах ожидаемый чистый месячный поток неположителен — переплата по кредиту не окупается в линейной модели.',
      );
    }
  }

  let capitalAfterLoanUsd: number | null = null;
  let capitalAfterHorizonUsd: number | null = null;
  let wentNegativeDuringLoan = false;

  if (
    rDaily != null &&
    rDaily > -1 &&
    C0 > 0 &&
    termM > 0 &&
    Number.isFinite(M) &&
    E > 0 &&
    basePnlPerDayUsd != null
  ) {
    const f = monthGrowthFactorFromRDaily(rDaily);
    let C = C0;
    for (let m = 0; m < termM; m++) {
      C = C * f - M;
      if (C < 0) {
        wentNegativeDuringLoan = true;
        warnings.push('В дискретной месячной модели капитал ушёл ниже нуля до конца срока кредита.');
        break;
      }
    }
    capitalAfterLoanUsd = C;
    if (!wentNegativeDuringLoan && horizonAfter > 0) {
      capitalAfterHorizonUsd = C * Math.pow(f, horizonAfter);
    }
  }

  return {
    mode,
    basePnlPerDayUsd,
    rDaily,
    equityUsd: E,
    loanPrincipalUsd: L,
    capitalWithLoanUsd: C0,
    grossDailyStartUsd,
    grossMonthlyStartUsd,
    netMonthlyStartUsd,
    dailyLoanBurdenUsd,
    breakEvenCapitalUsd,
    surplusVsBreakEvenUsd,
    totalPaidUsd,
    overpaymentUsd,
    monthsToRecoverOverpayment,
    capitalAfterLoanUsd,
    capitalAfterHorizonUsd,
    wentNegativeDuringLoan,
    warnings,
  };
}

export function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)} USDT`;
}

export function formatMonths(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n} мес.`;
}

export type TrajectoryPoint = {
  month: number;
  capitalUsd: number;
  cumulativePaidUsd: number;
  phase: 'loan' | 'after';
};

/**
 * Месячная дискретизация: при фазе loan — C←C·(1+r)³⁰−M, после — только рост.
 */
export function buildMonthlyCapitalTrajectory(opts: {
  equityUsd: number;
  loanPrincipalUsd: number;
  monthlyPaymentUsd: number;
  termMonths: number;
  horizonMonthsAfter: number;
  rDaily: number;
}): TrajectoryPoint[] {
  const { equityUsd: E, loanPrincipalUsd: L, monthlyPaymentUsd: M, termMonths, horizonMonthsAfter, rDaily } =
    opts;
  if (!(E > 0 && L >= 0 && Number.isFinite(rDaily) && rDaily > -1)) {
    return [];
  }
  const f = monthGrowthFactorFromRDaily(rDaily);
  const totalMonths = Math.max(0, termMonths) + Math.max(0, horizonMonthsAfter);
  let C = E + L;
  const out: TrajectoryPoint[] = [
    { month: 0, capitalUsd: C, cumulativePaidUsd: 0, phase: 'loan' },
  ];
  let paid = 0;
  const tm = Math.max(0, Math.floor(termMonths));
  for (let m = 1; m <= totalMonths; m++) {
    if (m <= tm) {
      C = C * f - M;
      paid += M;
      out.push({ month: m, capitalUsd: C, cumulativePaidUsd: paid, phase: 'loan' });
    } else {
      C = C * f;
      out.push({ month: m, capitalUsd: C, cumulativePaidUsd: paid, phase: 'after' });
    }
  }
  return out;
}

/** Дата последнего месяца договора: старт + termMonths (упрощённо). */
export function computeContractEndDate(loanStart: Date, termMonths: number): Date {
  const d = new Date(loanStart.getTime());
  d.setMonth(d.getMonth() + Math.max(0, Math.floor(termMonths)));
  return d;
}

export function formatDateRuLong(d: Date): string {
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function parseIsoDateOnly(raw: string | undefined): Date | null {
  const t = String(raw ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function todayIsoDateOnly(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
