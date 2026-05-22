export const USERBOT_POLL_INTERVAL_MS = 2000;
/** Верхняя граница `lastSeenMessageIds` в памяти (защита от роста Map по числу chatId). */
export const USERBOT_LAST_SEEN_MESSAGE_IDS_MAX = 4000;
export const USERBOT_POLL_FETCH_LIMIT = 20;
export const USERBOT_PROCESSING_CONCURRENCY = 4;
export const USERBOT_MAX_QUEUE_DEFAULT = 300;
export const USERBOT_INLINE_TEXT_MAX_CHARS = 4_000;
export const USERBOT_MAX_MESSAGE_AGE_MINUTES_DEFAULT = 10;
export const USERBOT_MIN_BALANCE_USD_DEFAULT = 3;
export const USERBOT_BALANCE_CHECK_CACHE_MS = 30_000;
export const USERBOT_FILTER_MATCH_THRESHOLD = 0.34;
export const CLOSE_REOPEN_COOLDOWN_MS = 30_000;
export { CRITICAL_NOTIFY_URL } from '../../common/critical-notify.constants';
export const OPENROUTER_BALANCE_LOW_THRESHOLD_USD = 2;
export const OPENROUTER_BALANCE_NOTIFY_COOLDOWN_MS = 30 * 60_000;
/** Опрос Telegram после parse_incomplete / place_error (edit-watch). */
export const USERBOT_INGEST_EDIT_WATCH_POLL_MS = 25_000;
export const USERBOT_INGEST_EDIT_WATCH_TTL_MS = 90 * 60_000;
/** @deprecated используйте USERBOT_INGEST_EDIT_WATCH_* */
export const USERBOT_SIGNAL_LEVELS_EDIT_WATCH_POLL_MS = USERBOT_INGEST_EDIT_WATCH_POLL_MS;
/** @deprecated используйте USERBOT_INGEST_EDIT_WATCH_* */
export const USERBOT_SIGNAL_LEVELS_EDIT_WATCH_TTL_MS = USERBOT_INGEST_EDIT_WATCH_TTL_MS;

/** Ingest-статусы, при которых правка сообщения должна перезапускать обработку. */
export const USERBOT_INGEST_RETRIABLE_STATUSES = [
  'parse_incomplete',
  'place_error',
  'duplicate_signal',
  'parse_error',
] as const;
/**
 * Период записи MTProto StringSession в глобальный Setting (миграция DC и др.).
 * Задаётся env TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS (мс), минимум 60000.
 */
export const TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_DEFAULT = 600_000;
export const TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_MIN = 60_000;
export const TELEGRAM_USERBOT_SESSION_PERSIST_INTERVAL_MS_MAX = 3_600_000;

/** После 406 AUTH_KEY_DUPLICATED не дергать Telegram reconnect (watchdog/старт). Env: TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS */
export const TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_DEFAULT = 15 * 60_000;
export const TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_MIN = 60_000;
export const TELEGRAM_USERBOT_AUTH_KEY_DUPLICATE_BACKOFF_MS_MAX = 60 * 60_000;
