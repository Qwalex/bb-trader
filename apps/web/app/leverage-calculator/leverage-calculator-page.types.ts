import type { LeverageCalcMode, LeverageLoanPaymentTiming } from './leverage-calculator-page.util';

export type LeverageInputCurrency = 'USD' | 'RUB';

export type LeverageCalculatorPayload = {
  equityUsd: number | null;
  expectedPnlPerDayUsd: number | null;
  realizedPnlPerDayUsd: number | null;
  statsPeriodDaysMax: number | null;
  totalPnlUsd: number;
  cabinetCount: number;
  statsCabinetId: string | null;
  statsCabinetName: string | null;
  statsScope: 'all' | 'cabinet';
};

export type LeverageCalculatorPresetV1 = {
  v: 1;
  /** Валюта ввода сумм кредита в форме; в настройках всегда хранятся USDT-числа. */
  inputCurrency: LeverageInputCurrency;
  principalUsd: number;
  monthlyPaymentUsd: number;
  /** Прочие фиксированные расходы в месяц с того же счёта (USDT в БД). */
  otherMonthlyExpensesUsd?: number;
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
  /** Постоянный взнос на торговый счёт в месяц (USDT в БД). */
  monthlyContributionUsd?: number;
  /** Целевой капитал C на конец горизонта симуляции (USDT в БД). */
  targetCapitalUsd?: number;
};
