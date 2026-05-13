/**
 * Модель: дневная доходность r = G/E (как блок «перспектива» на главной),
 * G — выбранная база (ожидаемый PnL/день по EV или реализованный / max(period)).
 * Старт на счёте: C₀ = E + L (свои средства + заём на том же торговом балансе).
 * Платёж M по кредиту всегда списывается с этого же счёта, а не «снаружи».
 *
 * Два режима дискретного месяца (30 дней = (1+r)³⁰):
 * - `after_monthly_return`: сначала C←C·f (доходность на весь остаток), затем C←C−M — M с **итога** месяца на счёте.
 * - `before_monthly_return`: сначала C←C−M (сняли платёж с текущего счёта), затем C←C·f — консервативнее, если банк списывает в начале периода.
 */

export type LeverageCalcMode = 'expected' | 'realized';

/** Как в месячном шаге совмещаются платёж M и начисление r на едином счёте E+L. */
export type LeverageLoanPaymentTiming = 'after_monthly_return' | 'before_monthly_return';

export type LeverageLoanParams = {
  principalUsd: number;
  monthlyPaymentUsd: number;
  termMonths: number;
};

/** Досрочное закрытие: в конце месяца `closeAfterMonth` платим M + closeoutUsd, далее без долга. */
export type LeverageEarlyPayoffParams = {
  closeAfterMonth: number;
  closeoutUsd: number;
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
  /**
   * Валовый торговый результат за первый дискретный месяц: база × ((1+r)³⁰−1),
   * база = C₀ при «после доходности» и (C₀−M) при «сначала M» — как в `simulateLeverageLoan`.
   */
  grossMonthlyStartUsd: number | null;
  /** Изменение капитала за первый месяц (конец − старт), как в симуляции. */
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
  /**
   * Тот же горизонт месяцев, но без займа: только E, сложный процент E·(1+r)³⁰ᵐ, без платежей.
   * Сравнение «что было бы на своих» при той же оценке r.
   */
  equityOnlyAfterLoanUsd: number | null;
  equityOnlyAfterHorizonUsd: number | null;
  /** Капитал с займом минус сценарий только на E (конец срока кредита). */
  deltaAfterLoanVsEquityOnlyUsd: number | null;
  /** То же на полном горизонте симуляции (после кредита + horizon). */
  deltaHorizonVsEquityOnlyUsd: number | null;
  wentNegativeDuringLoan: boolean;

  /** Включён и валиден сценарий досрочного (срок ≥ 2 мес., месяц 1..term−1). */
  earlyPayoffComparable: boolean;
  /** Капитал на конец горизонта при досрочном закрытии. */
  capitalAfterHorizonEarlyUsd: number | null;
  /** Всего ушло банку при досрочном (M·k + closeout). */
  totalPaidEarlyUsd: number | null;
  /** Полный график M·T минус факт при досрочном (+ = меньше заплатили банку). */
  bankCashflowSavingsVsFullScheduleUsd: number | null;
  /** Капитал на горизонте: досрочный минус по графику. */
  capitalHorizonEarlyVsStandardUsd: number | null;
  /** M·(T−k) − closeout: + если разовый выход дешевле, чем платить все оставшиеся M (грубая аннуитетная оценка). */
  earlyCloseoutVsAnnuityTailUsd: number | null;
  wentNegativeDuringLoanEarly: boolean;

  /** Как в симуляции совмещаются M и r (см. `LeverageLoanPaymentTiming`). */
  loanPaymentTiming: LeverageLoanPaymentTiming;

  /**
   * Подразумеваемая ставка кредита из пары (L, M, срок), если платёж — ровный аннуитет:
   * M = L·i(1+i)ⁿ/((1+i)ⁿ−1), i — месячная; null если комбинация несовместима.
   */
  loanImpliedMonthlyRate: number | null;
  /** Номинальная годовая: 12·i (в долях единицы, для отображения ×100). */
  loanNominalApr: number | null;
  /** Эффективная годовая: (1+i)¹²−1. */
  loanEffectiveAnnualRate: number | null;

  /** Прочие фиксированные расходы с того же счёта каждый месяц (весь горизонт симуляции). */
  otherMonthlyExpensesUsd: number;
  /**
   * Максимум постоянного дополнительного снятия в месяц (тот же счёт), при котором капитал C
   * не опускается ниже нуля ни в одном месяце на полном горизонте; учитывается текущий сценарий досрочного (если валиден).
   */
  maxExtraMonthlyWithdrawalUsd: number | null;

  warnings: string[];
};

const DAYS_PER_MONTH = 30;

/**
 * Месячная ставка i из аннуитета: M = L · i(1+i)ⁿ / ((1+i)ⁿ − 1).
 * При M ≤ L/n безположительного i нет (платёж не покрывает даже равномерное погашение тела без %%).
 */
export function impliedMonthlyRateFromAnnuity(
  principalUsd: number,
  monthlyPaymentUsd: number,
  termMonths: number,
): number | null {
  const L = Number.isFinite(principalUsd) ? Math.max(0, principalUsd) : 0;
  const M = Number.isFinite(monthlyPaymentUsd) ? Math.max(0, monthlyPaymentUsd) : 0;
  const n = Math.max(0, Math.floor(Number.isFinite(termMonths) ? termMonths : 0));
  if (!(L > 0 && M > 0 && n >= 1)) return null;

  const ratio = M / L;
  const minInterestFree = 1 / n;
  if (ratio < minInterestFree - 1e-12) return null;
  if (ratio <= minInterestFree + 1e-14) return 0;

  const paymentFactor = (i: number): number => {
    if (i <= 1e-14) return minInterestFree;
    const ip1 = 1 + i;
    const p = Math.pow(ip1, n);
    return (i * p) / (p - 1);
  };

  let lo = 0;
  let hi = 0.01;
  while (paymentFactor(hi) < ratio && hi < 50) {
    hi *= 2;
  }
  if (paymentFactor(hi) < ratio) return null;

  for (let k = 0; k < 120; k++) {
    const mid = (lo + hi) / 2;
    const f = paymentFactor(mid);
    if (Math.abs(f - ratio) <= Math.max(ratio * 1e-12, 1e-14)) return mid;
    if (f < ratio) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function formatPercentRate(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)} %`;
}

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

export type TrajectoryPoint = {
  month: number;
  capitalUsd: number;
  cumulativePaidUsd: number;
  phase: 'loan' | 'after';
};

export type LoanSimResult = {
  trajectory: TrajectoryPoint[];
  totalPaidUsd: number;
  wentNegativeDuringLoan: boolean;
};

const TRAJ_SAFE_EPS = 1e-6;
const MAX_EXTRA_MONTHLY_USD = 5e7;

function trajectoryNeverNegative(sim: LoanSimResult): boolean {
  if (sim.trajectory.length === 0) return false;
  return sim.trajectory.every((p) => p.capitalUsd >= -TRAJ_SAFE_EPS);
}

/**
 * Максимум постоянного дополнительного снятия D (USDT/мес) с того же счёта, что и торговый капитал,
 * при фиксированных M, прочих расходах X и выбранном графике кредита (в т.ч. досрочном), так что
 * C ≥ 0 в каждом месяце на всём горизонте term+horizon. Если при D=0 уже есть отрицательный C — 0.
 */
export function computeMaxExtraMonthlyWithdrawalUsd(opts: {
  equityUsd: number;
  loanPrincipalUsd: number;
  monthlyPaymentUsd: number;
  termMonths: number;
  horizonMonthsAfter: number;
  rDaily: number;
  early: LeverageEarlyPayoffParams | null;
  loanPaymentTiming: LeverageLoanPaymentTiming;
  otherMonthlyExpensesUsd: number;
}): number | null {
  const X = Math.max(0, opts.otherMonthlyExpensesUsd);
  const base = {
    equityUsd: opts.equityUsd,
    loanPrincipalUsd: opts.loanPrincipalUsd,
    monthlyPaymentUsd: opts.monthlyPaymentUsd,
    termMonths: opts.termMonths,
    horizonMonthsAfter: opts.horizonMonthsAfter,
    rDaily: opts.rDaily,
    early: opts.early,
    loanPaymentTiming: opts.loanPaymentTiming,
    otherMonthlyExpensesUsd: X,
    extraMonthlyWithdrawalUsd: 0,
  };

  const ok = (d: number): boolean =>
    trajectoryNeverNegative(simulateLeverageLoan({ ...base, extraMonthlyWithdrawalUsd: d }));

  if (!ok(0)) return 0;

  let lo = 0;
  let hi = Math.max(1, opts.monthlyPaymentUsd + X);

  if (ok(hi)) {
    lo = hi;
    while (lo < MAX_EXTRA_MONTHLY_USD - TRAJ_SAFE_EPS) {
      const nxt = Math.min(MAX_EXTRA_MONTHLY_USD, lo * 2);
      if (!ok(nxt)) {
        hi = nxt;
        break;
      }
      if (nxt >= MAX_EXTRA_MONTHLY_USD - TRAJ_SAFE_EPS) {
        return MAX_EXTRA_MONTHLY_USD;
      }
      lo = nxt;
    }
    if (ok(lo) && lo >= MAX_EXTRA_MONTHLY_USD - TRAJ_SAFE_EPS) {
      return MAX_EXTRA_MONTHLY_USD;
    }
  }

  for (let i = 0; i < 80; i++) {
    if (hi - lo < TRAJ_SAFE_EPS) break;
    const mid = (lo + hi) / 2;
    if (ok(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Месячная дискретизация на **едином счёте** C (начало C₀=E+L). Платёж M уменьшает тот же C;
 * при заданных X и Dextra каждый месяц дополнительно списываются X и Dextra (прочие / доп. снятие).
 * Порядок шага задаётся `loanPaymentTiming` (см. описание в шапке файла).
 */
export function simulateLeverageLoan(opts: {
  equityUsd: number;
  loanPrincipalUsd: number;
  monthlyPaymentUsd: number;
  termMonths: number;
  horizonMonthsAfter: number;
  rDaily: number;
  early: LeverageEarlyPayoffParams | null;
  loanPaymentTiming?: LeverageLoanPaymentTiming;
  /** Прочие расходы с того же счёта каждый месяц (весь горизонт), не входят в «выплачено банку». */
  otherMonthlyExpensesUsd?: number;
  /** Дополнительное постоянное снятие с того же счёта каждый месяц (поиск максимума). */
  extraMonthlyWithdrawalUsd?: number;
}): LoanSimResult {
  const E = Number.isFinite(opts.equityUsd) ? Math.max(0, opts.equityUsd) : 0;
  const L = Number.isFinite(opts.loanPrincipalUsd) ? Math.max(0, opts.loanPrincipalUsd) : 0;
  const M = Number.isFinite(opts.monthlyPaymentUsd) ? Math.max(0, opts.monthlyPaymentUsd) : 0;
  const Xraw = opts.otherMonthlyExpensesUsd;
  const X = Xraw != null && Number.isFinite(Xraw) ? Math.max(0, Xraw) : 0;
  const Draw = opts.extraMonthlyWithdrawalUsd;
  const Dextra = Draw != null && Number.isFinite(Draw) ? Math.max(0, Draw) : 0;
  const termM = Math.max(0, Math.floor(opts.termMonths));
  const horizon = Math.max(0, Math.floor(opts.horizonMonthsAfter));
  const rDaily = opts.rDaily;

  if (!(E > 0 && L >= 0 && Number.isFinite(rDaily) && rDaily > -1)) {
    return { trajectory: [], totalPaidUsd: 0, wentNegativeDuringLoan: false };
  }

  const f = monthGrowthFactorFromRDaily(rDaily);
  const totalSim = termM + horizon;
  const timing: LeverageLoanPaymentTiming = opts.loanPaymentTiming ?? 'after_monthly_return';

  let closeMonth = 0;
  let closeout = 0;
  const early = opts.early;
  if (early && termM >= 2 && M > 0) {
    const k = Math.floor(early.closeAfterMonth);
    if (k >= 1 && k < termM) {
      closeMonth = k;
      closeout = Number.isFinite(early.closeoutUsd) ? Math.max(0, early.closeoutUsd) : 0;
    }
  }

  let C = E + L;
  const out: TrajectoryPoint[] = [{ month: 0, capitalUsd: C, cumulativePaidUsd: 0, phase: 'loan' }];
  let paid = 0;
  let wentNegative = false;

  for (let m = 1; m <= totalSim; m++) {
    let payment = 0;
    let phase: 'loan' | 'after' = 'after';

    if (closeMonth > 0) {
      if (m < closeMonth) {
        payment = M;
        phase = 'loan';
      } else if (m === closeMonth) {
        payment = M + closeout;
        phase = 'loan';
      } else {
        payment = 0;
        phase = m <= termM ? 'after' : 'after';
      }
    } else if (termM > 0) {
      if (m <= termM) {
        payment = M;
        phase = 'loan';
      } else {
        payment = 0;
        phase = 'after';
      }
    }

    const bankPayment = payment;
    const totalOut = bankPayment + X + Dextra;

    if (timing === 'before_monthly_return') {
      C = (C - totalOut) * f;
    } else {
      C = C * f - totalOut;
    }
    paid += bankPayment;
    if (C < 0 && !wentNegative) {
      wentNegative = true;
    }
    out.push({ month: m, capitalUsd: C, cumulativePaidUsd: paid, phase });
  }

  return { trajectory: out, totalPaidUsd: paid, wentNegativeDuringLoan: wentNegative };
}

export function computeLeverageOutlook(params: {
  equityUsd: number;
  expectedPnlPerDayUsd: number | null | undefined;
  realizedPnlPerDayUsd: number | null | undefined;
  mode: LeverageCalcMode;
  loan: LeverageLoanParams;
  /** Месяцев после последнего платежа по кредиту — «перспектива». */
  horizonMonthsAfterLoan: number;
  earlyPayoff?: LeverageEarlyPayoffParams | null;
  loanPaymentTiming?: LeverageLoanPaymentTiming;
  /** Прочие фиксированные расходы USDT/мес с того же счёта (весь горизонт симуляции). */
  otherMonthlyExpensesUsd?: number;
}): LeverageOutlook {
  const warnings: string[] = [];
  const ep = params.earlyPayoff ?? null;
  const closeoutEp =
    ep != null && Number.isFinite(ep.closeoutUsd) ? Math.max(0, ep.closeoutUsd) : 0;
  const paymentTiming: LeverageLoanPaymentTiming = params.loanPaymentTiming ?? 'after_monthly_return';
  const { mode, loan } = params;
  const E = Number.isFinite(params.equityUsd) ? Math.max(0, params.equityUsd) : 0;
  const L = Number.isFinite(loan.principalUsd) ? Math.max(0, loan.principalUsd) : 0;
  const M = Number.isFinite(loan.monthlyPaymentUsd) ? Math.max(0, loan.monthlyPaymentUsd) : 0;
  const Xraw = params.otherMonthlyExpensesUsd;
  const X = Xraw != null && Number.isFinite(Xraw) ? Math.max(0, Xraw) : 0;
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

  let grossMonthlyStartUsd: number | null = null;
  let netMonthlyStartUsd: number | null = null;
  if (rDaily != null && Number.isFinite(rDaily) && rDaily > -1 && C0 > 0) {
    const f = monthGrowthFactorFromRDaily(rDaily);
    if (paymentTiming === 'before_monthly_return') {
      const base = C0 - M - X;
      grossMonthlyStartUsd = base > 0 ? base * (f - 1) : null;
      netMonthlyStartUsd = (C0 - M - X) * f - C0;
    } else {
      grossMonthlyStartUsd = C0 * (f - 1);
      netMonthlyStartUsd = C0 * f - M - X - C0;
    }
    if (grossMonthlyStartUsd != null && !Number.isFinite(grossMonthlyStartUsd)) {
      grossMonthlyStartUsd = null;
    }
    if (!Number.isFinite(netMonthlyStartUsd)) {
      netMonthlyStartUsd = null;
    }
  } else if (grossDailyStartUsd != null) {
    grossMonthlyStartUsd = grossDailyStartUsd * DAYS_PER_MONTH;
    netMonthlyStartUsd = grossMonthlyStartUsd - M - X;
  }

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

  const iMonth = impliedMonthlyRateFromAnnuity(L, M, termM);
  const loanImpliedMonthlyRate = iMonth != null && Number.isFinite(iMonth) ? iMonth : null;
  const loanNominalApr = loanImpliedMonthlyRate != null ? loanImpliedMonthlyRate * 12 : null;
  const loanEffectiveAnnualRate =
    loanImpliedMonthlyRate != null ? Math.pow(1 + loanImpliedMonthlyRate, 12) - 1 : null;

  if (L > 0 && M > 0 && termM >= 1 && iMonth === null && M / L < 1 / termM - 1e-12) {
    warnings.push(
      'Платёж меньше L/T — для классического аннуитета комбинация несовместима; подразумеваемая годовая ставка по кредиту не выведена.',
    );
  }

  let monthsToRecoverOverpayment: number | null = null;
  if (overpaymentUsd > 0 && netMonthlyStartUsd != null && netMonthlyStartUsd > 1e-6) {
    monthsToRecoverOverpayment = Math.ceil(overpaymentUsd / netMonthlyStartUsd);
  } else if (overpaymentUsd > 0 && (netMonthlyStartUsd == null || netMonthlyStartUsd <= 0)) {
    monthsToRecoverOverpayment = null;
    if (netMonthlyStartUsd != null && netMonthlyStartUsd <= 0) {
      warnings.push(
        'При стартовых параметрах чистый прирост капитала за первый месяц (как в дискретной симуляции) неположителен — переплата по кредиту в упрощённой оценке «месяцев до окупаемости» не считается.',
      );
    }
  }

  let capitalAfterLoanUsd: number | null = null;
  let capitalAfterHorizonUsd: number | null = null;
  let wentNegativeDuringLoan = false;

  const stdSim =
    rDaily != null && rDaily > -1 && C0 > 0 && termM > 0 && Number.isFinite(M) && E > 0 && basePnlPerDayUsd != null
      ? simulateLeverageLoan({
          equityUsd: E,
          loanPrincipalUsd: L,
          monthlyPaymentUsd: M,
          termMonths: termM,
          horizonMonthsAfter: horizonAfter,
          rDaily,
          early: null,
          loanPaymentTiming: paymentTiming,
          otherMonthlyExpensesUsd: X,
          extraMonthlyWithdrawalUsd: 0,
        })
      : null;

  if (stdSim) {
    wentNegativeDuringLoan = stdSim.wentNegativeDuringLoan;
    if (wentNegativeDuringLoan) {
      warnings.push('В дискретной месячной модели капитал ушёл ниже нуля до конца срока кредита.');
    }
    const ptEndLoan = stdSim.trajectory[termM];
    capitalAfterLoanUsd = ptEndLoan != null ? ptEndLoan.capitalUsd : null;
    const ptHorizon = stdSim.trajectory[termM + horizonAfter];
    capitalAfterHorizonUsd = ptHorizon != null ? ptHorizon.capitalUsd : null;
  }

  let equityOnlyAfterLoanUsd: number | null = null;
  let equityOnlyAfterHorizonUsd: number | null = null;
  if (rDaily != null && rDaily > -1 && E > 0 && termM > 0) {
    const fEq = monthGrowthFactorFromRDaily(rDaily);
    equityOnlyAfterLoanUsd = E * Math.pow(fEq, termM);
    equityOnlyAfterHorizonUsd = E * Math.pow(fEq, termM + horizonAfter);
  }

  let deltaAfterLoanVsEquityOnlyUsd: number | null = null;
  let deltaHorizonVsEquityOnlyUsd: number | null = null;
  if (capitalAfterLoanUsd != null && equityOnlyAfterLoanUsd != null) {
    deltaAfterLoanVsEquityOnlyUsd = capitalAfterLoanUsd - equityOnlyAfterLoanUsd;
  }
  if (capitalAfterHorizonUsd != null && equityOnlyAfterHorizonUsd != null) {
    deltaHorizonVsEquityOnlyUsd = capitalAfterHorizonUsd - equityOnlyAfterHorizonUsd;
  }

  let earlyPayoffComparable = false;
  let capitalAfterHorizonEarlyUsd: number | null = null;
  let totalPaidEarlyUsd: number | null = null;
  let bankCashflowSavingsVsFullScheduleUsd: number | null = null;
  let capitalHorizonEarlyVsStandardUsd: number | null = null;
  let earlyCloseoutVsAnnuityTailUsd: number | null = null;
  let wentNegativeDuringLoanEarly = false;

  if (
    ep &&
    stdSim &&
    rDaily != null &&
    rDaily > -1 &&
    termM >= 2 &&
    ep.closeAfterMonth >= 1 &&
    ep.closeAfterMonth < termM
  ) {
    const closeout = closeoutEp;
    if (closeout <= 0) {
      warnings.push(
        'Досрочное погашение: укажите разовый платёж при закрытии (остаток долга и комиссии банка по договору).',
      );
    } else {
      earlyPayoffComparable = true;
      const earlySim = simulateLeverageLoan({
        equityUsd: E,
        loanPrincipalUsd: L,
        monthlyPaymentUsd: M,
        termMonths: termM,
        horizonMonthsAfter: horizonAfter,
        rDaily,
        early: { closeAfterMonth: ep.closeAfterMonth, closeoutUsd: closeout },
        loanPaymentTiming: paymentTiming,
        otherMonthlyExpensesUsd: X,
        extraMonthlyWithdrawalUsd: 0,
      });
      wentNegativeDuringLoanEarly = earlySim.wentNegativeDuringLoan;
      if (wentNegativeDuringLoanEarly) {
        warnings.push('Досрочный сценарий: капитал ушёл ниже нуля в модели — проверьте платежи и closeout.');
      }
      const last = earlySim.trajectory[termM + horizonAfter];
      capitalAfterHorizonEarlyUsd = last != null ? last.capitalUsd : null;
      totalPaidEarlyUsd = earlySim.totalPaidUsd;
      bankCashflowSavingsVsFullScheduleUsd = M * termM - earlySim.totalPaidUsd;
      if (capitalAfterHorizonUsd != null && capitalAfterHorizonEarlyUsd != null) {
        capitalHorizonEarlyVsStandardUsd = capitalAfterHorizonEarlyUsd - capitalAfterHorizonUsd;
      }
      const tail = M * (termM - ep.closeAfterMonth);
      earlyCloseoutVsAnnuityTailUsd = tail - closeout;
    }
  } else if (ep && termM > 0 && termM < 2) {
    warnings.push('Досрочное погашение в модели доступно при сроке кредита не меньше 2 месяцев.');
  }

  let maxExtraMonthlyWithdrawalUsd: number | null = null;
  if (
    rDaily != null &&
    rDaily > -1 &&
    C0 > 0 &&
    termM > 0 &&
    Number.isFinite(M) &&
    E > 0 &&
    basePnlPerDayUsd != null
  ) {
    const earlyForMax: LeverageEarlyPayoffParams | null =
      earlyPayoffComparable && ep
        ? { closeAfterMonth: ep.closeAfterMonth, closeoutUsd: closeoutEp }
        : null;
    maxExtraMonthlyWithdrawalUsd = computeMaxExtraMonthlyWithdrawalUsd({
      equityUsd: E,
      loanPrincipalUsd: L,
      monthlyPaymentUsd: M,
      termMonths: termM,
      horizonMonthsAfter: horizonAfter,
      rDaily,
      early: earlyForMax,
      loanPaymentTiming: paymentTiming,
      otherMonthlyExpensesUsd: X,
    });
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
    equityOnlyAfterLoanUsd,
    equityOnlyAfterHorizonUsd,
    deltaAfterLoanVsEquityOnlyUsd,
    deltaHorizonVsEquityOnlyUsd,
    wentNegativeDuringLoan,
    earlyPayoffComparable,
    capitalAfterHorizonEarlyUsd,
    totalPaidEarlyUsd,
    bankCashflowSavingsVsFullScheduleUsd,
    capitalHorizonEarlyVsStandardUsd,
    earlyCloseoutVsAnnuityTailUsd,
    wentNegativeDuringLoanEarly,
    loanPaymentTiming: paymentTiming,
    loanImpliedMonthlyRate,
    loanNominalApr,
    loanEffectiveAnnualRate,
    otherMonthlyExpensesUsd: X,
    maxExtraMonthlyWithdrawalUsd,
    warnings,
  };
}

/** Короткие подсказки по цифрам модели (не индивидуальная инвестконсультация). */
export function computeLeverageStrategyHints(o: LeverageOutlook): string[] {
  const hints: string[] = [];
  if (o.deltaHorizonVsEquityOnlyUsd != null && o.deltaHorizonVsEquityOnlyUsd < 0) {
    hints.push(
      'На выбранном горизонте при текущей оценке r сценарий без займа (только E) даёт больший капитал, чем с кредитом по графику — смысл займа в модели сомнителен, если r не занижен.',
    );
  }
  if (o.netMonthlyStartUsd != null && o.netMonthlyStartUsd <= 0) {
    hints.push(
      'Чистый прирост за первый дискретный месяц неположителен: платёж съедает прирост при той же схеме шага, что и симуляция — смотрите траекторию и предупреждения.',
    );
  }
  if (
    o.maxExtraMonthlyWithdrawalUsd != null &&
    Number.isFinite(o.maxExtraMonthlyWithdrawalUsd) &&
    o.maxExtraMonthlyWithdrawalUsd > 1e-6
  ) {
    hints.push(
      `По дискретной модели на весь горизонт (M, прочие расходы и валидный досрочный, если включён) можно добавить постоянное снятие примерно до ${o.maxExtraMonthlyWithdrawalUsd.toFixed(2)} USDT/мес, не опуская капитал C ниже нуля ни в одном месяце.`,
    );
  }
  if (o.earlyPayoffComparable) {
    if (
      o.bankCashflowSavingsVsFullScheduleUsd != null &&
      o.bankCashflowSavingsVsFullScheduleUsd > 1e-6
    ) {
      hints.push(
        'При введённом досрочном вы платите банку меньше, чем по полному графику M·T — по денежному потоку к банку сценарий выгоднее (без учёта альтернативной доходности этих денег).',
      );
    }
    if (o.earlyCloseoutVsAnnuityTailUsd != null && o.earlyCloseoutVsAnnuityTailUsd > 1e-6) {
      hints.push(
        'Разовый платёж при закрытии ниже суммы оставшихся аннуитетных M по модели — относительно этой грубой оценки досрочное «дешевле», чем продолжать платить до конца срока.',
      );
    }
    if (
      o.capitalHorizonEarlyVsStandardUsd != null &&
      o.capitalHorizonEarlyVsStandardUsd > 1e-6 &&
      o.rDaily != null &&
      o.rDaily > 0
    ) {
      hints.push(
        'На конец горизонта капитал при досрочном выше, чем при выплате по графику: раньше сняли долговую нагрузку — больше месяцев чистого роста при том же r.',
      );
    }
    if (
      o.capitalHorizonEarlyVsStandardUsd != null &&
      o.capitalHorizonEarlyVsStandardUsd < -1e-6
    ) {
      hints.push(
        'На конец горизонта досрочный даёт меньший капитал, чем полный график: разовый выход сильно съедает торговый счёт — имеет смысл сравнить closeout с выгодой от досрочного в договоре или перенести закрытие на более поздний месяц.',
      );
    }
  } else if (
    o.loanPrincipalUsd > 0 &&
    o.rDaily != null &&
    o.rDaily > 0 &&
    o.deltaHorizonVsEquityOnlyUsd != null &&
    o.deltaHorizonVsEquityOnlyUsd > 0
  ) {
    hints.push(
      'Если банк предлагает досрочное с суммой меньше оставшихся платежей по графику, внесите её в блок «досрочно» и сравните капитал на горизонте с полным графиком.',
    );
  }

  return hints;
}

export function formatUsd(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)} USDT`;
}

/** Дельты: со знаком «+» / «−» для сравнения сценариев. */
export function formatUsdSigned(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${Math.abs(n).toFixed(digits)} USDT`;
}

export function formatMonths(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n} мес.`;
}

/**
 * Капитал только на собственных средствах E при той же r: месяц m → E·(1+r)³⁰ᵐ (без займа и без платежей).
 */
export function equityOnlyCapitalAtMonth(equityUsd: number, rDaily: number, month: number): number {
  const E = Number.isFinite(equityUsd) ? Math.max(0, equityUsd) : 0;
  const m = Math.max(0, Math.floor(Number.isFinite(month) ? month : 0));
  if (!(E > 0 && Number.isFinite(rDaily) && rDaily > -1)) return Number.NaN;
  const f = monthGrowthFactorFromRDaily(rDaily);
  return E * Math.pow(f, m);
}

/**
 * Месячная траектория капитала C на едином счёте (см. `simulateLeverageLoan`).
 */
export function buildMonthlyCapitalTrajectory(opts: {
  equityUsd: number;
  loanPrincipalUsd: number;
  monthlyPaymentUsd: number;
  termMonths: number;
  horizonMonthsAfter: number;
  rDaily: number;
  loanPaymentTiming?: LeverageLoanPaymentTiming;
  otherMonthlyExpensesUsd?: number;
}): TrajectoryPoint[] {
  const sim = simulateLeverageLoan({ ...opts, early: null, extraMonthlyWithdrawalUsd: 0 });
  return sim.trajectory;
}

/** Траектория с досрочным закрытием (для графика). */
export function buildMonthlyCapitalTrajectoryEarly(opts: {
  equityUsd: number;
  loanPrincipalUsd: number;
  monthlyPaymentUsd: number;
  termMonths: number;
  horizonMonthsAfter: number;
  rDaily: number;
  early: LeverageEarlyPayoffParams;
  loanPaymentTiming?: LeverageLoanPaymentTiming;
  otherMonthlyExpensesUsd?: number;
}): TrajectoryPoint[] {
  const sim = simulateLeverageLoan({ ...opts, extraMonthlyWithdrawalUsd: 0 });
  return sim.trajectory;
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
