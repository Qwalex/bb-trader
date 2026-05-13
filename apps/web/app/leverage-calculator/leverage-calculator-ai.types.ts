export type LeverageCalculatorAiAdviceResponse =
  | { ok: true; summary: string; points: string[]; disclaimer: string }
  | { ok: false; error: string };
