import type { LeverageCalculatorPayload } from './leverage-calculator-page.types';
import type { LeverageCalcMode, LeverageOutlook } from './leverage-calculator-page.util';

const OUTLOOK_SNAPSHOT_KEYS = [
  'mode',
  'basePnlPerDayUsd',
  'rDaily',
  'equityUsd',
  'loanPrincipalUsd',
  'capitalWithLoanUsd',
  'grossDailyStartUsd',
  'grossMonthlyStartUsd',
  'netMonthlyStartUsd',
  'dailyLoanBurdenUsd',
  'breakEvenCapitalUsd',
  'surplusVsBreakEvenUsd',
  'totalPaidUsd',
  'overpaymentUsd',
  'monthsToRecoverOverpayment',
  'capitalAfterLoanUsd',
  'capitalAfterHorizonUsd',
  'equityOnlyAfterLoanUsd',
  'equityOnlyAfterHorizonUsd',
  'deltaAfterLoanVsEquityOnlyUsd',
  'deltaHorizonVsEquityOnlyUsd',
  'wentNegativeDuringLoan',
  'earlyPayoffComparable',
  'capitalAfterHorizonEarlyUsd',
  'totalPaidEarlyUsd',
  'bankCashflowSavingsVsFullScheduleUsd',
  'capitalHorizonEarlyVsStandardUsd',
  'earlyCloseoutVsAnnuityTailUsd',
  'wentNegativeDuringLoanEarly',
  'loanPaymentTiming',
  'loanImpliedMonthlyRate',
  'loanNominalApr',
  'loanEffectiveAnnualRate',
  'otherMonthlyExpensesUsd',
  'maxExtraMonthlyWithdrawalUsd',
  'monthlyContributionUsd',
  'targetCapitalUsd',
  'minMonthlyContributionForTargetUsd',
] as const;

function pickOutlookSnapshot(o: LeverageOutlook): Record<string, unknown> {
  const src = o as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of OUTLOOK_SNAPSHOT_KEYS) {
    const v = src[k];
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function buildLeverageAiAdviceRequest(input: {
  mode: LeverageCalcMode;
  horizonMonthsAfterLoan: number;
  loan: { principalUsd: number; monthlyPaymentUsd: number; termMonths: number };
  earlyPayoffEnabled: boolean;
  earlyPayoffForOutlook: { closeAfterMonth: number; closeoutUsd: number } | null;
  payload: LeverageCalculatorPayload;
  outlook: LeverageOutlook;
  verdict: { tone: string; lead: string } | null;
  hints: string[];
  warnings: string[];
  userComment: string;
}): Record<string, unknown> {
  const early =
    input.earlyPayoffEnabled && input.earlyPayoffForOutlook
      ? {
          enabled: true,
          closeAfterMonth: input.earlyPayoffForOutlook.closeAfterMonth,
          closeoutUsd: input.earlyPayoffForOutlook.closeoutUsd,
        }
      : { enabled: false };

  return {
    mode: input.mode,
    horizonMonthsAfterLoan: input.horizonMonthsAfterLoan,
    loan: input.loan,
    earlyPayoff: early,
    payload: {
      equityUsd: input.payload.equityUsd,
      expectedPnlPerDayUsd: input.payload.expectedPnlPerDayUsd,
      realizedPnlPerDayUsd: input.payload.realizedPnlPerDayUsd,
      statsPeriodDaysMax: input.payload.statsPeriodDaysMax,
      cabinetCount: input.payload.cabinetCount,
    },
    outlookSnapshot: pickOutlookSnapshot(input.outlook),
    verdict: input.verdict,
    hints: input.hints.slice(0, 12),
    warnings: input.warnings.slice(0, 12),
    ...(input.userComment.trim().length > 0 ? { userComment: input.userComment.trim().slice(0, 800) } : {}),
  };
}