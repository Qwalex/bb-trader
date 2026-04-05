export const MODEL_HISTORY_KEY = 'OPENROUTER_MODEL_HISTORY';
export const DIAGNOSTIC_MODELS_KEY = 'OPENROUTER_DIAGNOSTIC_MODELS';
export const KEYS = [
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API key' },
  { key: 'OPENROUTER_MODEL_DEFAULT', label: 'Модель по умолчанию' },
  { key: 'OPENROUTER_MODEL_TEXT', label: 'Модель (текст)' },
  { key: 'OPENROUTER_MODEL_AI_ADVISOR', label: 'Модель (AI рекомендации)' },
  { key: 'OPENROUTER_MODEL_TEXT_FALLBACK_1', label: 'Fallback модель (текст) #1' },
  { key: 'OPENROUTER_MODEL_IMAGE', label: 'Модель (изображение)' },
  { key: 'OPENROUTER_MODEL_IMAGE_FALLBACK_1', label: 'Fallback модель (изображение) #1' },
  { key: 'OPENROUTER_MODEL_AUDIO', label: 'Модель (аудио)' },
  { key: 'OPENROUTER_MODEL_AUDIO_FALLBACK_1', label: 'Fallback модель (аудио) #1' },
  {
    key: 'DIAGNOSTIC_BATCH_SIZE',
    label: 'Диагностика: размер батча (сколько последних кейсов проверять за запуск)',
  },
  {
    key: 'DIAGNOSTIC_MAX_LOG_LINES',
    label: 'Диагностика: лимит логов AppLog на один кейс',
  },
  {
    key: 'APPLOG_LOG_NOISY_EVENTS',
    label:
      'Логи AppLog: писать в БД шумные события (poll, userbot debug и т.п.; по умолчанию выкл)',
  },
  {
    key: 'BYBIT_TESTNET',
    label:
      'Bybit: режим testnet (true = тестовая сеть, false = основной боевой счёт)',
  },
  {
    key: 'MIN_CAPITAL_AMOUNT',
    label:
      'Минимальный номинал (USDT) для режима % депозита, если расчёт ниже минимума',
  },
  {
    key: 'DEFAULT_ORDER_USD',
    label: 'Дефолт суммы входа (если в сигнале не указан размер)',
  },
  {
    key: 'BUMP_TO_MIN_EXCHANGE_LOT',
    label:
      'Увеличивать сумму входа до минимального лота биржи, если номинала не хватает (true/false; по умолчанию false)',
  },
  {
    key: 'DEFAULT_LEVERAGE_ENABLED',
    label: 'Включить кредитное плечо по умолчанию',
  },
  {
    key: 'DEFAULT_LEVERAGE',
    label: 'Кредитное плечо по умолчанию (целое число, например 10)',
  },
  {
    key: 'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
    label: 'Мартингейл: дефолтный множитель после убыточной сделки (например 1.2)',
  },
  { key: 'BYBIT_API_KEY_TESTNET', label: 'Bybit API key (testnet)' },
  { key: 'BYBIT_API_SECRET_TESTNET', label: 'Bybit API secret (testnet)' },
  { key: 'BYBIT_API_KEY_MAINNET', label: 'Bybit API key (основной / боевой)' },
  {
    key: 'BYBIT_API_SECRET_MAINNET',
    label: 'Bybit API secret (основной / боевой)',
  },
  { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram bot token' },
  { key: 'TELEGRAM_USERBOT_API_ID', label: 'Telegram Userbot API ID (my.telegram.org)' },
  { key: 'TELEGRAM_USERBOT_API_HASH', label: 'Telegram Userbot API Hash (my.telegram.org)' },
  { key: 'TELEGRAM_USERBOT_2FA_PASSWORD', label: 'Telegram Userbot 2FA password (если включен)' },
  { key: 'TELEGRAM_USERBOT_ENABLED', label: 'Userbot: включен (true/false)' },
  {
    key: 'TELEGRAM_USERBOT_POLL_INTERVAL_MS',
    label: 'Userbot: интервал чтения сообщений (мс, от 500 до 60000)',
  },
  { key: 'TELEGRAM_USERBOT_USE_AI_CLASSIFIER', label: 'Userbot: AI-классификация сообщений (true/false)' },
  { key: 'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION', label: 'Userbot: требовать подтверждение перед размещением (true/false)' },
  {
    key: 'TELEGRAM_USERBOT_MIN_BALANCE_USD',
    label:
      'Userbot: минимальный баланс USDT для автоторговли (если ниже — автоустановка ордеров приостановлена)',
  },
  {
    key: 'TELEGRAM_USERBOT_NOTIFY_FAILURES',
    label:
      'Userbot: присылать ошибки обработки сигнала в бота (true/false)',
  },
  {
    key: 'TELEGRAM_USERBOT_NOTIFY_RESULT_WITHOUT_ENTRY',
    label:
      'Userbot: уведомлять о возможно неактуальном ордере (в группе result по сигналу, а входа в позицию ещё не было) (true/false)',
  },
  {
    key: 'TELEGRAM_USERBOT_CANCEL_STALE_ORDERS_ON_RESULT_WITHOUT_ENTRY',
    label:
      'Userbot: отменять возможно не актуальные ордера при result без входа (true/false)',
  },
  {
    key: 'TELEGRAM_NOTIFY_API_TRADE_CANCELLED',
    label:
      'Telegram: уведомлять об отмене сделки/ордеров (по умолчанию да; false / 0 / off — отключить)',
  },
  {
    key: 'SIGNAL_SOURCE',
    label:
      'Источник сигналов (канал / приложение, для статистики: Binance Killers, Crypto Signals, …)',
  },
  { key: 'TELEGRAM_WHITELIST', label: 'Telegram user IDs (через запятую)' },
  { key: 'POLLING_INTERVAL_MS', label: 'Polling (0 = отключить опрос Bybit)' },
] as const;

export const BOOLEAN_KEYS = new Set<string>([
  'APPLOG_LOG_NOISY_EVENTS',
  'BYBIT_TESTNET',
  'BUMP_TO_MIN_EXCHANGE_LOT',
  'DEFAULT_LEVERAGE_ENABLED',
  'TELEGRAM_USERBOT_ENABLED',
  'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
  'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION',
  'TELEGRAM_USERBOT_NOTIFY_FAILURES',
  'TELEGRAM_USERBOT_NOTIFY_RESULT_WITHOUT_ENTRY',
  'TELEGRAM_USERBOT_CANCEL_STALE_ORDERS_ON_RESULT_WITHOUT_ENTRY',
  'TELEGRAM_NOTIFY_API_TRADE_CANCELLED',
]);
export const MODEL_KEYS = new Set<string>(
  KEYS.map(({ key }) => key).filter((key) => key.startsWith('OPENROUTER_MODEL_')),
);
export const LABEL_BY_KEY = Object.fromEntries(KEYS.map(({ key, label }) => [key, label])) as Record<
  string,
  string
>;

export const EXTRA_LABELS: Record<string, string> = {
  SOURCE_LIST: 'Список источников (source)',
  SOURCE_EXCLUDE_LIST: 'Исключённые источники (аналитика)',
  [DIAGNOSTIC_MODELS_KEY]: 'Модели для диагностики',
  [MODEL_HISTORY_KEY]: 'История моделей OpenRouter (автообновление)',
};

export function labelForKey(key: string): string {
  return LABEL_BY_KEY[key] ?? EXTRA_LABELS[key] ?? key;
}

export const SETTINGS_SECTIONS: { id: string; title: string; keys: string[] }[] = [
  {
    id: 'openrouter',
    title: 'OpenRouter',
    keys: [
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL_DEFAULT',
      'OPENROUTER_MODEL_TEXT',
      'OPENROUTER_MODEL_AI_ADVISOR',
      'OPENROUTER_MODEL_TEXT_FALLBACK_1',
      'OPENROUTER_MODEL_IMAGE',
      'OPENROUTER_MODEL_IMAGE_FALLBACK_1',
      'OPENROUTER_MODEL_AUDIO',
      'OPENROUTER_MODEL_AUDIO_FALLBACK_1',
    ],
  },
  {
    id: 'trading',
    title: 'Торговые параметры',
    keys: [
      'MIN_CAPITAL_AMOUNT',
      'DEFAULT_ORDER_USD',
      'BUMP_TO_MIN_EXCHANGE_LOT',
      'DEFAULT_LEVERAGE_ENABLED',
      'DEFAULT_LEVERAGE',
      'SOURCE_MARTINGALE_DEFAULT_MULTIPLIER',
      'POLLING_INTERVAL_MS',
    ],
  },
  {
    id: 'diagnostics',
    title: 'Диагностика',
    keys: [
      'DIAGNOSTIC_BATCH_SIZE',
      'DIAGNOSTIC_MAX_LOG_LINES',
      'APPLOG_LOG_NOISY_EVENTS',
    ],
  },
  {
    id: 'bybit',
    title: 'Bybit',
    keys: [
      'BYBIT_TESTNET',
      'BYBIT_API_KEY_TESTNET',
      'BYBIT_API_SECRET_TESTNET',
      'BYBIT_API_KEY_MAINNET',
      'BYBIT_API_SECRET_MAINNET',
    ],
  },
  {
    id: 'telegram',
    title: 'Telegram / Userbot',
    keys: [
      'TELEGRAM_BOT_TOKEN',
      'TELEGRAM_USERBOT_API_ID',
      'TELEGRAM_USERBOT_API_HASH',
      'TELEGRAM_USERBOT_2FA_PASSWORD',
      'TELEGRAM_USERBOT_ENABLED',
      'TELEGRAM_USERBOT_POLL_INTERVAL_MS',
      'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
      'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION',
      'TELEGRAM_USERBOT_MIN_BALANCE_USD',
      'TELEGRAM_USERBOT_NOTIFY_FAILURES',
      'TELEGRAM_USERBOT_NOTIFY_RESULT_WITHOUT_ENTRY',
      'TELEGRAM_USERBOT_CANCEL_STALE_ORDERS_ON_RESULT_WITHOUT_ENTRY',
      'TELEGRAM_NOTIFY_API_TRADE_CANCELLED',
      'SIGNAL_SOURCE',
      'TELEGRAM_WHITELIST',
    ],
  },
];

/** Порядок PUT при сохранении: поля из KEYS, затем списки, в конце — история моделей. */
export const PUT_ORDER: string[] = [
  ...KEYS.map(({ key }) => key),
  'SOURCE_LIST',
  'SOURCE_EXCLUDE_LIST',
  DIAGNOSTIC_MODELS_KEY,
  MODEL_HISTORY_KEY,
];

export function parseModelHistory(raw: string): string[] {
  if (!raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean)
      .slice(0, 50);
  } catch {
    return [];
  }
}

export function mergeModelHistory(current: string[], value: string): string[] {
  const v = value.trim();
  if (!v) return current;
  return [v, ...current.filter((item) => item !== v)].slice(0, 50);
}
