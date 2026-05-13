/** Тело POST `/orders/leverage-calculator-ai-advice` (снимок с клиента). */
export type LeverageCalculatorAiAdviceRequest = {
  mode: 'expected' | 'realized';
  horizonMonthsAfterLoan: number;
  loan: {
    principalUsd: number;
    monthlyPaymentUsd: number;
    termMonths: number;
  };
  earlyPayoff: {
    enabled: boolean;
    closeAfterMonth?: number;
    closeoutUsd?: number;
  };
  payload: {
    equityUsd: number | null;
    expectedPnlPerDayUsd: number | null;
    realizedPnlPerDayUsd: number | null;
    statsPeriodDaysMax: number | null;
    cabinetCount: number;
  };
  outlookSnapshot: Record<string, unknown>;
  verdict: { tone: string; lead: string } | null;
  hints: string[];
  warnings: string[];
  userComment?: string;
};

export type LeverageCalculatorAiAdviceOk = {
  ok: true;
  summary: string;
  points: string[];
  disclaimer: string;
};

export type LeverageCalculatorAiAdviceErr = {
  ok: false;
  error: string;
};

export type LeverageCalculatorAiAdviceResponse =
  | LeverageCalculatorAiAdviceOk
  | LeverageCalculatorAiAdviceErr;
