import type { LeverageCalcMode } from './leverage-calculator-page.util';

export type LeverageCalculatorPresetV1 = {
  v: 1;
  principalUsd: number;
  monthlyPaymentUsd: number;
  termYears: number;
  horizonMonthsAfterLoan: number;
  mode: LeverageCalcMode;
  /** ISO YYYY-MM-DD — от неё считается дата «закрытия» договора. */
  loanStartIso: string;
};
