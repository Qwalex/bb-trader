import type { LeverageCalcMode, LeverageLoanPaymentTiming } from './leverage-calculator-page.util';

export type LeverageCalculatorPayload = {
  equityUsd: number | null;
  expectedPnlPerDayUsd: number | null;
  realizedPnlPerDayUsd: number | null;
  statsPeriodDaysMax: number | null;
  totalPnlUsd: number;
  cabinetCount: number;
};

export type LeverageCalculatorPresetV1 = {
  v: 1;
  principalUsd: number;
  monthlyPaymentUsd: number;
  termYears: number;
  horizonMonthsAfterLoan: number;
  mode: LeverageCalcMode;
  /** Порядок шага месяца: M с того же счёта, что и E+L (см. калькулятор). */
  loanPaymentTiming: LeverageLoanPaymentTiming;
  /** ISO YYYY-MM-DD — от неё считается дата «закрытия» договора. */
  loanStartIso: string;
  /** Досрочное погашение в симуляции (остаток + комиссии — ввод пользователя). */
  earlyPayoffEnabled?: boolean;
  /** Месяц (1..T−1), в конце которого M + closeout и долг закрыт. */
  earlyPayoffAfterMonth?: number;
  earlyCloseoutUsd?: number;
};
