import type { DiagnosticStepKey } from './diagnostics.types';

export const DIAGNOSTIC_MODELS_KEY = 'OPENROUTER_DIAGNOSTIC_MODELS';
export const DIAGNOSTIC_BATCH_SIZE_KEY = 'DIAGNOSTIC_BATCH_SIZE';
export const DIAGNOSTIC_MAX_LOG_LINES_KEY = 'DIAGNOSTIC_MAX_LOG_LINES';

export const DEFAULT_DIAGNOSTIC_MODELS: string[] = [];
export const DEFAULT_DIAGNOSTIC_BATCH_SIZE = 5;
export const DEFAULT_DIAGNOSTIC_MAX_LOG_LINES = 120;

export const DIAGNOSTIC_AI_STEP_KEYS: DiagnosticStepKey[] = [
  'settings_resolution',
  'userbot_ingest',
  'message_classification',
  'filters_and_examples',
  'signal_parsing',
  'signal_execution',
  'reentry_and_close_handling',
  'trade_persistence',
  'metrics_consistency',
  'end_to_end_summary',
];
