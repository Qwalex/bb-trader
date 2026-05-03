import { NAV_MENU_HIDDEN_SETTING_KEY } from '@repo/shared';

export const DASHBOARD_TODOS_MAX_ITEMS = 200;
export const DASHBOARD_TODOS_MAX_ID_LEN = 80;
export const DASHBOARD_TODOS_MAX_TEXT_LEN = 4000;

export const ENV_FALLBACK: Record<string, string> = {
  APPLOG_ENABLED: 'true',
  DEFAULT_ORDER_USD: '10',
  BUMP_TO_MIN_EXCHANGE_LOT: 'false',
  APPLOG_LOG_NOISY_EVENTS: 'false',
  TP_SL_STEP_RANGE: '',
  /** Минимальный интервал между REST-вызовами Bybit на один кабинет (мс). */
  BYBIT_ACCOUNT_REQUEST_INTERVAL_MS: '80',
  /**
   * Зарезервировано: в production-safe limiter параллельные REST-каналы на кабинет не используются
   * (значение >1 игнорируется, см. `BybitRateLimitService`).
   */
  BYBIT_ACCOUNT_MAX_CONCURRENCY: '1',
  /** Базовая задержка при признаках rate limit (мс), умножается на номер попытки. */
  BYBIT_RATE_LIMIT_BACKOFF_MS: '2000',
  /**
   * Private WS: при нескольких кабинетах один глобальный WS некорректен.
   * `auto` — не поднимать WS, если кабинетов > 1; `force` — как раньше (один ключ).
   */
  BYBIT_WS_MULTI_CABINET: 'auto',
};

export const GLOBAL_SHARED_SETTING_KEYS = new Set<string>([
  NAV_MENU_HIDDEN_SETTING_KEY,
  'OPENROUTER_API_KEY',
  'OPENROUTER_MODEL_DEFAULT',
  'OPENROUTER_MODEL_TEXT',
  'OPENROUTER_MODEL_AI_ADVISOR',
  'OPENROUTER_MODEL_TEXT_FALLBACK_1',
  'OPENROUTER_MODEL_IMAGE',
  'OPENROUTER_MODEL_IMAGE_FALLBACK_1',
  'OPENROUTER_MODEL_AUDIO',
  'OPENROUTER_MODEL_AUDIO_FALLBACK_1',
  'OPENROUTER_MODEL_HISTORY',
  'DIAGNOSTIC_BATCH_SIZE',
  'DIAGNOSTIC_MAX_LOG_LINES',
  'APPLOG_ENABLED',
  'APPLOG_LOG_NOISY_EVENTS',
  'TELEGRAM_USERBOT_API_ID',
  'TELEGRAM_USERBOT_API_HASH',
  /** QR/сессия: читаются из глобальной `Setting`, иначе при залогиненном владельце `get()` не видит глобальное значение. */
  'TELEGRAM_USERBOT_2FA_PASSWORD',
  'TELEGRAM_USERBOT_SESSION',
  'TELEGRAM_USERBOT_MTPROXY_URL',
  'OPENROUTER_DIAGNOSTIC_MODELS',
  'MIN_CAPITAL_AMOUNT',
  'DEFAULT_ORDER_USD',
  'BUMP_TO_MIN_EXCHANGE_LOT',
  'DEFAULT_LEVERAGE_ENABLED',
  'DEFAULT_LEVERAGE',
  'FORCED_LEVERAGE',
  'LEVERAGE_RANGE_MODE',
  'MIN_ALLOWED_LEVERAGE',
  'MAX_ALLOWED_LEVERAGE',
  'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
  'POLLING_INTERVAL_MS',
  'BYBIT_ACCOUNT_MAX_CONCURRENCY',
  'TP_SL_STEP_START',
  'TP_SL_STEP_RANGE',
]);

export const ADMIN_ONLY_GLOBAL_KEYS = new Set<string>(GLOBAL_SHARED_SETTING_KEYS);
