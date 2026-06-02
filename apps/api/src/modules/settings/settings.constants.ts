import { NAV_MENU_HIDDEN_SETTING_KEY } from '@repo/shared';

export const DASHBOARD_TODOS_MAX_ITEMS = 200;
export const DASHBOARD_TODOS_MAX_ID_LEN = 80;
export const DASHBOARD_TODOS_MAX_TEXT_LEN = 4000;

export const ENV_FALLBACK: Record<string, string> = {
  APPLOG_ENABLED: 'true',
  /** Интервал enqueue poll sweep Bybit (мс). 0 — выключить опрос (только для отладки). */
  POLLING_INTERVAL_MS: '2000',
  MIN_CAPITAL_AMOUNT: '6',
  DEFAULT_ORDER_USD: '6',
  BUMP_TO_MIN_EXCHANGE_LOT: 'false',
  DEFAULT_LEVERAGE_ENABLED: 'true',
  DEFAULT_LEVERAGE: '5',
  LEVERAGE_RANGE_MODE: 'mid',
  TP_SL_STEP_START: 'tp1',
  APPLOG_LOG_NOISY_EVENTS: 'false',
  TP_SL_STEP_RANGE: '1',
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
  TP_SL_FAST_APPLY_ENABLED: 'true',
  TP_SL_FAST_RETRY_DELAYS_MS: '0,300,700,1500,3000,5000',
  WORKER_QUEUE_POLL_CONCURRENCY: '3',
  /** Фоновое исправление «зависших» сделок (sync + TP/SL). */
  STUCK_TRADES_AUTO_HEAL_ENABLED: 'true',
  /** Интервал sweep auto-heal (мс). */
  STUCK_TRADES_AUTO_HEAL_INTERVAL_MS: '180000',
  /** Макс. сделок на один heal-job (на кабинет). */
  STUCK_TRADES_AUTO_HEAL_MAX_PER_RUN: '2',
  /** Пауза перед повторной попыткой heal для той же сделки после успеха (мс). */
  STUCK_TRADES_AUTO_HEAL_COOLDOWN_MS: '600000',
  /** Пауза после неудачной попытки heal (мс). */
  STUCK_TRADES_AUTO_HEAL_DEFER_BACKOFF_MS: '120000',
};

/** Ключ глобальной настройки: `AuthUser.id` владельца, под которым сохранена `TELEGRAM_USERBOT_SESSION`. */
export const TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY =
  'TELEGRAM_USERBOT_SESSION_OWNER_USER_ID';

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
  /** Сессия/прокси: глобальная `Setting` (см. AUD-058/060). Пароль 2FA не хранится — ввод при QR через API. */
  'TELEGRAM_USERBOT_SESSION',
  TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY,
  'TELEGRAM_USERBOT_MTPROXY_URL',
  'OPENROUTER_DIAGNOSTIC_MODELS',
  /** Глобально: опрос статусов ордеров/позиций Bybit (см. `BybitPollService`). */
  'POLLING_INTERVAL_MS',
  'TP_SL_FAST_APPLY_ENABLED',
  'TP_SL_FAST_RETRY_DELAYS_MS',
  'WORKER_QUEUE_POLL_CONCURRENCY',
  'STUCK_TRADES_AUTO_HEAL_ENABLED',
  'STUCK_TRADES_AUTO_HEAL_INTERVAL_MS',
  'STUCK_TRADES_AUTO_HEAL_MAX_PER_RUN',
  'STUCK_TRADES_AUTO_HEAL_COOLDOWN_MS',
  'STUCK_TRADES_AUTO_HEAL_DEFER_BACKOFF_MS',
]);

export const ADMIN_ONLY_GLOBAL_KEYS = new Set<string>(GLOBAL_SHARED_SETTING_KEYS);
