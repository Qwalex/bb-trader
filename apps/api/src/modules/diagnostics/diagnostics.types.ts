export type DiagnosticStatus = 'ok' | 'warning' | 'error' | 'unknown';

export type DiagnosticStepKey =
  | 'settings_resolution'
  | 'userbot_ingest'
  | 'message_classification'
  | 'filters_and_examples'
  | 'signal_parsing'
  | 'signal_execution'
  | 'reentry_and_close_handling'
  | 'trade_persistence'
  | 'metrics_consistency'
  | 'end_to_end_summary'
  | 'metrics_consistency_verifier';

export type DiagnosticStepAudit = {
  stepKey: DiagnosticStepKey;
  status: DiagnosticStatus;
  comment: string;
  issues: string[];
  evidence: string[];
  missingContext: string[];
  recommendedFixes: string[];
};

export type DiagnosticCaseTrace = {
  ingest: {
    id: string;
    chatId: string;
    messageId: string;
    classification: string;
    status: string;
    error: string | null;
    signalHash: string | null;
    createdAt: string;
    text: string | null;
    aiRequest: string | null;
    aiResponse: string | null;
  };
  signal: unknown | null;
  logs: unknown[];
  settingsSnapshot: Record<string, string | null>;
  filterPatterns: unknown[];
  filterExamples: unknown[];
  bybitSnapshot: unknown | null;
  classificationReplay: unknown | null;
  metricsSnapshot: {
    dashboard: unknown;
    pnlSeriesDay: unknown;
  };
};

export type DiagnosticModelAuditResult = {
  status: DiagnosticStatus;
  finalComment: string;
  steps: DiagnosticStepAudit[];
  rawResponse: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  requestPreview: string;
};
