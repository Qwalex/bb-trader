'use client';

import { useEffect, useMemo, useState } from 'react';

import { TRADE_SIGNAL_NOTIFY_EVENT_OPTIONS } from '@repo/shared';

import { EntrySizingControl } from '../components/EntrySizingControl';
import { getApiBase } from '../../lib/api';
import { parseStoredEntry, serializeEntry } from '../../lib/entry-sizing';

function normalizeBasePath(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!t || t === '/') return '';
  return (t.startsWith('/') ? t : `/${t}`).replace(/\/+$/, '');
}

const appBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
function withAppBasePath(url: string): string {
  if (!url.startsWith('/')) return url;
  return `${appBasePath}${url}`;
}

const MODEL_HISTORY_KEY = 'OPENROUTER_MODEL_HISTORY';
const DIAGNOSTIC_MODELS_KEY = 'OPENROUTER_DIAGNOSTIC_MODELS';
const KEYS = [
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
  {
    key: 'TELEGRAM_USERBOT_MTPROXY_URL',
    label: 'Telegram Userbot MTProxy URL (формат https://t.me/proxy?server=...&port=...&secret=...)',
  },
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
    key: 'TELEGRAM_NOTIFY_TRADE_EVENTS',
    label:
      'Telegram: уведомлять о событиях по сделкам (журнал: SL после TP, закрытие Bybit, перезаход и т.д.; по умолчанию вкл.)',
  },
  {
    key: 'TELEGRAM_NOTIFY_TRADE_EVENT_TYPES',
    label: 'Telegram: фильтр типов событий сделки (список ниже)',
  },
  {
    key: 'SIGNAL_SOURCE',
    label:
      'Источник сигналов (канал / приложение, для статистики: Binance Killers, Crypto Signals, …)',
  },
  { key: 'TELEGRAM_WHITELIST', label: 'Telegram user IDs (через запятую)' },
  { key: 'POLLING_INTERVAL_MS', label: 'Polling (0 = отключить опрос Bybit)' },
  {
    key: 'TP_SL_STEP_START',
    label:
      'Подтягивание SL после TP: с какого уровня начинать лестницу (off / tp1–tp5). Устаревший TP_SL_STEP_ENABLED=true в БД эквивалентен tp2, пока не задана эта строка',
  },
  {
    key: 'TP_SL_STEP_RANGE',
    label:
      'Подтягивание SL: диапазон лестницы (1–5 TP «назад» по счёту исполненных TP; пусто = как номер старта). Переопределение по чату: SOURCE_TP_SL_STEP_RANGE',
  },
] as const;

const BOOLEAN_KEYS = new Set<string>([
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

const MODEL_KEYS = new Set<string>(
  KEYS.map(({ key }) => key).filter((key) => key.startsWith('OPENROUTER_MODEL_')),
);
const LABEL_BY_KEY = Object.fromEntries(KEYS.map(({ key, label }) => [key, label])) as Record<
  string,
  string
>;

const EXTRA_LABELS: Record<string, string> = {
  SOURCE_LIST: 'Список источников (source)',
  SOURCE_EXCLUDE_LIST: 'Исключённые источники (аналитика)',
  SOURCE_TP_SL_STEP_RANGE:
    'Переопределение диапазона SL после TP по источнику (JSON: имя чата lower → 1..5)',
  DASHBOARD_TODOS: 'Заметки дашборда (удобнее редактировать на главной странице)',
  [DIAGNOSTIC_MODELS_KEY]: 'Модели для диагностики',
  [MODEL_HISTORY_KEY]: 'История моделей OpenRouter (автообновление)',
};

function labelForKey(key: string): string {
  return LABEL_BY_KEY[key] ?? EXTRA_LABELS[key] ?? key;
}

const SETTINGS_SECTIONS: { id: string; title: string; keys: string[] }[] = [
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
      'TP_SL_STEP_START',
      'TP_SL_STEP_RANGE',
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
      'TELEGRAM_USERBOT_MTPROXY_URL',
      'TELEGRAM_USERBOT_ENABLED',
      'TELEGRAM_USERBOT_POLL_INTERVAL_MS',
      'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
      'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION',
      'TELEGRAM_USERBOT_MIN_BALANCE_USD',
      'TELEGRAM_USERBOT_NOTIFY_FAILURES',
      'TELEGRAM_USERBOT_NOTIFY_RESULT_WITHOUT_ENTRY',
      'TELEGRAM_USERBOT_CANCEL_STALE_ORDERS_ON_RESULT_WITHOUT_ENTRY',
      'TELEGRAM_NOTIFY_API_TRADE_CANCELLED',
      'TELEGRAM_NOTIFY_TRADE_EVENTS',
      'TELEGRAM_NOTIFY_TRADE_EVENT_TYPES',
      'SIGNAL_SOURCE',
      'TELEGRAM_WHITELIST',
    ],
  },
];

/** Порядок PUT при сохранении: поля из KEYS, затем списки, в конце — история моделей. */
const PUT_ORDER: string[] = [
  ...KEYS.map(({ key }) => key),
  'SOURCE_LIST',
  'SOURCE_EXCLUDE_LIST',
  DIAGNOSTIC_MODELS_KEY,
  MODEL_HISTORY_KEY,
];

function parseModelHistory(raw: string): string[] {
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

function mergeModelHistory(current: string[], value: string): string[] {
  const v = value.trim();
  if (!v) return current;
  return [v, ...current.filter((item) => item !== v)].slice(0, 50);
}

type Row = { key: string; value: string };

function valueFor(rows: Row[], key: string): string {
  return rows.find((r) => r.key === key)?.value ?? '';
}

function upsertRow(list: Row[], key: string, value: string): Row[] {
  const i = list.findIndex((r) => r.key === key);
  if (i >= 0) {
    const next = [...list];
    next[i] = { key, value };
    return next;
  }
  return [...list, { key, value }];
}

function normCompare(a: string, b: string): boolean {
  return a.trim() === b.trim();
}

/** История моделей после сохранения изменённых полей моделей (как при последовательных PUT). */
function computeNextModelHistoryString(saved: Row[], draft: Row[]): string {
  let hist = parseModelHistory(valueFor(saved, MODEL_HISTORY_KEY));
  for (const { key } of KEYS) {
    if (!MODEL_KEYS.has(key)) continue;
    const newV = valueFor(draft, key).trim();
    const oldV = valueFor(saved, key).trim();
    if (newV && newV !== oldV) {
      hist = mergeModelHistory(hist, newV);
    }
  }
  return JSON.stringify(hist);
}

function isSensitiveKey(key: string): boolean {
  const u = key.toUpperCase();
  return (
    u.includes('SECRET') ||
    u.includes('TOKEN') ||
    u.includes('PASSWORD') ||
    u.includes('MTPROXY') ||
    u === 'OPENROUTER_API_KEY' ||
    u.includes('API_HASH') ||
    u.includes('2FA')
  );
}

function formatPreviewValue(key: string, value: string): string {
  if (!value) return '(пусто)';
  if (isSensitiveKey(key)) return '•••• (скрыто)';
  const t = value.length > 200 ? `${value.slice(0, 200)}…` : value;
  return t;
}

type PendingChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

function collectPendingChanges(saved: Row[], draft: Row[]): PendingChange[] {
  const out: PendingChange[] = [];

  for (const { key } of KEYS) {
    if (normCompare(valueFor(draft, key), valueFor(saved, key))) continue;
    out.push({
      key,
      label: labelForKey(key),
      before: formatPreviewValue(key, valueFor(saved, key)),
      after: formatPreviewValue(key, valueFor(draft, key)),
    });
  }

  for (const ek of ['SOURCE_LIST', 'SOURCE_EXCLUDE_LIST', DIAGNOSTIC_MODELS_KEY] as const) {
    if (normCompare(valueFor(draft, ek), valueFor(saved, ek))) continue;
    out.push({
      key: ek,
      label: labelForKey(ek),
      before: formatPreviewValue(ek, valueFor(saved, ek)),
      after: formatPreviewValue(ek, valueFor(draft, ek)),
    });
  }

  const nextHist = computeNextModelHistoryString(saved, draft);
  if (!normCompare(nextHist, valueFor(saved, MODEL_HISTORY_KEY))) {
    out.push({
      key: MODEL_HISTORY_KEY,
      label: labelForKey(MODEL_HISTORY_KEY),
      before: formatPreviewValue(MODEL_HISTORY_KEY, valueFor(saved, MODEL_HISTORY_KEY)),
      after: formatPreviewValue(MODEL_HISTORY_KEY, nextHist),
    });
  }

  const orderKey = (k: string) => {
    const i = PUT_ORDER.indexOf(k);
    return i >= 0 ? i : 999;
  };
  return [...out].sort((a, b) => orderKey(a.key) - orderKey(b.key));
}

function buildPutOperations(saved: Row[], draft: Row[]): { key: string; value: string }[] {
  const ops: { key: string; value: string }[] = [];

  for (const { key } of KEYS) {
    if (normCompare(valueFor(draft, key), valueFor(saved, key))) continue;
    ops.push({ key, value: valueFor(draft, key).trim() });
  }

  for (const ek of ['SOURCE_LIST', 'SOURCE_EXCLUDE_LIST', DIAGNOSTIC_MODELS_KEY] as const) {
    if (normCompare(valueFor(draft, ek), valueFor(saved, ek))) continue;
    ops.push({ key: ek, value: valueFor(draft, ek) });
  }

  const nextHist = computeNextModelHistoryString(saved, draft);
  if (!normCompare(nextHist, valueFor(saved, MODEL_HISTORY_KEY))) {
    ops.push({ key: MODEL_HISTORY_KEY, value: nextHist });
  }

  const orderIndex = (k: string) => {
    const i = PUT_ORDER.indexOf(k);
    return i >= 0 ? i : 999;
  };
  ops.sort((a, b) => orderIndex(a.key) - orderIndex(b.key));
  return ops;
}

export default function SettingsPage() {
  const [savedRows, setSavedRows] = useState<Row[]>([]);
  const [draftRows, setDraftRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [resetting, setResetting] = useState(false);
  const [resettingStats, setResettingStats] = useState(false);
  const [newSource, setNewSource] = useState('');
  const [newExcludedSource, setNewExcludedSource] = useState('');
  const [newDiagnosticModel, setNewDiagnosticModel] = useState('');

  async function loadSettings() {
    try {
      const res = await fetch(`${getApiBase()}/settings/raw`);
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as {
        settings: Row[];
      };
      const list = j.settings ?? [];
      setSavedRows(list);
      setDraftRows(list);
    } catch {
      setMessage({ type: 'err', text: 'Не удалось загрузить настройки' });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(withAppBasePath('/api/settings-auth'));
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as {
          authenticated: boolean;
          enabled?: boolean;
        };
        if (j.enabled === false) {
          setAuthError('Пароль не настроен на web-сервере (SETTINGS_PAGE_PASSWORD)');
          setAuthenticated(false);
          setLoading(false);
          return;
        }
        setAuthenticated(Boolean(j.authenticated));
        if (j.authenticated) {
          await loadSettings();
        } else {
          setLoading(false);
        }
      } catch {
        setAuthError('Не удалось проверить доступ к странице настроек');
        setLoading(false);
      } finally {
        setAuthChecking(false);
      }
    })();
  }, []);

  const pendingChanges = useMemo(
    () => collectPendingChanges(savedRows, draftRows),
    [savedRows, draftRows],
  );
  const hasPendingChanges = pendingChanges.length > 0;

  const valueForDraft = (key: string) => valueFor(draftRows, key);
  const boolValueFor = (key: string) =>
    valueForDraft(key).trim().toLowerCase() === 'true';
  const modelHistory = useMemo(
    () => parseModelHistory(valueFor(draftRows, MODEL_HISTORY_KEY)),
    [draftRows],
  );

  function parseStringList(raw: string): string[] {
    const t = raw.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((v) => v.length > 0);
      }
    } catch {
      // ignore
    }
    return t
      .split(/[\n,]/g)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  const sourceList = parseStringList(valueForDraft('SOURCE_LIST'));
  const sourceListSorted = Array.from(new Set(sourceList)).sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
  const excludedSourceList = parseStringList(valueForDraft('SOURCE_EXCLUDE_LIST'));
  const excludedSourceListSorted = Array.from(new Set(excludedSourceList)).sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
  const diagnosticModels = parseStringList(valueForDraft(DIAGNOSTIC_MODELS_KEY));
  const diagnosticModelsSorted = Array.from(new Set(diagnosticModels)).sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

  function setDraftKey(key: string, value: string) {
    setDraftRows((prev) => upsertRow(prev, key, value));
  }

  function tradeEventSelectionFromDraft(raw: string): Set<string> {
    const t = raw.trim();
    const allIds: string[] = TRADE_SIGNAL_NOTIFY_EVENT_OPTIONS.map(
      (o: { id: string }) => o.id,
    );
    const all = new Set<string>(allIds);
    if (!t) {
      return new Set<string>(all);
    }
    try {
      const p = JSON.parse(t) as unknown;
      if (!Array.isArray(p)) {
        return new Set<string>(all);
      }
      if (p.length === 0) {
        return new Set<string>();
      }
      return new Set<string>(p.map((x: unknown) => String(x)));
    } catch {
      return new Set<string>(all);
    }
  }

  async function saveAll() {
    const ops = buildPutOperations(savedRows, draftRows);
    if (ops.length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      let next = [...savedRows];
      for (const { key, value } of ops) {
        const res = await fetch(`${getApiBase()}/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) {
          let detail = `${res.status}`;
          try {
            const j = (await res.json()) as { message?: string | string[] };
            const m = j?.message;
            if (typeof m === 'string') {
              detail = m;
            } else if (Array.isArray(m)) {
              detail = m.join('; ');
            }
          } catch {
            /* ignore */
          }
          throw new Error(detail);
        }
        let storedValue = value;
        if (key === 'TP_SL_STEP_RANGE') {
          storedValue = value.trim();
        } else if (key === 'SOURCE_TP_SL_STEP_RANGE' && value.trim() === '') {
          storedValue = '{}';
        }
        next = upsertRow(next, key, storedValue);
      }
      setSavedRows(next);
      setDraftRows(next);
      setMessage({ type: 'ok', text: 'Настройки сохранены' });
    } catch (e) {
      setMessage({
        type: 'err',
        text: e instanceof Error ? e.message : 'Ошибка сохранения',
      });
    } finally {
      setSaving(false);
    }
  }

  function revertDraft() {
    setDraftRows([...savedRows]);
    setMessage(null);
  }

  async function resetDatabase() {
    const ok = window.confirm(
      'Удалить все данные в SQLite на сервере API?\n\n' +
        'Будут удалены: сигналы, ордера, логи и сохранённые в БД настройки (ключи, токены и т.д.).\n' +
        'Переменные из .env не затрагиваются.',
    );
    if (!ok) {
      return;
    }
    setResetting(true);
    setMessage(null);
    try {
      const res = await fetch(`${getApiBase()}/settings/reset-database`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || String(res.status));
      }
      setSavedRows([]);
      setDraftRows([]);
      setMessage({
        type: 'ok',
        text: 'База данных очищена. Обновите страницу при необходимости.',
      });
    } catch {
      setMessage({ type: 'err', text: 'Не удалось сбросить базу данных' });
    } finally {
      setResetting(false);
    }
  }

  if (loading) {
    return <p style={{ color: 'var(--muted)' }}>Загрузка…</p>;
  }

  function addSource() {
    const v = newSource.trim();
    if (!v) return;
    const next = Array.from(new Set([...sourceListSorted, v]));
    setNewSource('');
    setDraftKey('SOURCE_LIST', JSON.stringify(next));
  }

  function removeSource(v: string) {
    const next = sourceListSorted.filter((x) => x !== v);
    setDraftKey('SOURCE_LIST', JSON.stringify(next));
  }

  function addExcludedSource() {
    const v = newExcludedSource.trim();
    if (!v) return;
    const next = Array.from(new Set([...excludedSourceListSorted, v]));
    setNewExcludedSource('');
    setDraftKey('SOURCE_EXCLUDE_LIST', JSON.stringify(next));
  }

  function removeExcludedSource(v: string) {
    const next = excludedSourceListSorted.filter((x) => x !== v);
    setDraftKey('SOURCE_EXCLUDE_LIST', JSON.stringify(next));
  }

  function addDiagnosticModel() {
    const v = newDiagnosticModel.trim();
    if (!v) return;
    const next = Array.from(new Set([...diagnosticModelsSorted, v]));
    setNewDiagnosticModel('');
    setDraftKey(DIAGNOSTIC_MODELS_KEY, JSON.stringify(next));
  }

  function removeDiagnosticModel(model: string) {
    const next = diagnosticModelsSorted.filter((x) => x !== model);
    setDraftKey(DIAGNOSTIC_MODELS_KEY, JSON.stringify(next));
  }

  async function resetStats() {
    const ok = window.confirm(
      'Сбросить статистику дашборда?\n\n' +
        'Метрики (winrate, PnL, W/L, закрытые сигналы, pnl по дням) начнут считаться заново с текущего момента.\n' +
        'История сделок и ордера не удаляются.',
    );
    if (!ok) {
      return;
    }
    setResettingStats(true);
    setMessage(null);
    try {
      const res = await fetch(`${getApiBase()}/orders/reset-stats`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || String(res.status));
      }
      setMessage({ type: 'ok', text: 'Статистика сброшена и считается заново.' });
    } catch {
      setMessage({ type: 'err', text: 'Не удалось сбросить статистику' });
    } finally {
      setResettingStats(false);
    }
  }

  async function submitPassword() {
    setAuthSubmitting(true);
    setAuthError(null);
    try {
      const res = await fetch(withAppBasePath('/api/settings-auth'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: authPassword }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { message?: string } | null;
        setAuthError(j?.message ?? 'Неверный пароль');
        return;
      }
      setAuthenticated(true);
      setLoading(true);
      await loadSettings();
    } catch {
      setAuthError('Не удалось выполнить вход');
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function logout() {
    await fetch(withAppBasePath('/api/settings-auth'), { method: 'DELETE' }).catch(
      () => undefined,
    );
    setAuthenticated(false);
    setAuthPassword('');
  }

  if (authChecking) {
    return <p style={{ color: 'var(--muted)' }}>Проверка доступа…</p>;
  }

  if (!authenticated) {
    return (
      <>
        <h1 className="pageTitle">Настройки</h1>
        <div className="card settingsAuthCard">
          <p style={{ color: 'var(--muted)', marginBottom: '0.75rem' }}>
            Страница защищена паролем.
          </p>
          {authError && <p className="msg err">{authError}</p>}
          <div className="settingsAuthForm">
            <input
              className="settingsAuthInput"
              type="password"
              value={authPassword}
              autoComplete="current-password"
              placeholder="Введите пароль"
              onChange={(e) => setAuthPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !authSubmitting && authPassword.trim()) {
                  void submitPassword();
                }
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={authSubmitting || !authPassword.trim()}
              onClick={() => void submitPassword()}
            >
              {authSubmitting ? 'Проверка…' : 'Войти'}
            </button>
          </div>
        </div>
      </>
    );
  }

  function renderSettingField(key: string) {
    if (key === 'TELEGRAM_NOTIFY_TRADE_EVENTS') {
      const raw = valueForDraft(key).trim().toLowerCase();
      const on =
        raw === '' || raw === 'true' || raw === '1' || raw === 'yes';
      const label = LABEL_BY_KEY[key] ?? key;
      return (
        <label key={key} className="settingRowSwitch">
          <span>{label}</span>
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            className={`switch ${on ? 'on' : 'off'}`}
            disabled={saving}
            onClick={() => {
              setDraftKey(key, on ? 'false' : 'true');
            }}
          >
            <span className="switchThumb" />
          </button>
        </label>
      );
    }
    if (key === 'TELEGRAM_NOTIFY_TRADE_EVENT_TYPES') {
      const label = LABEL_BY_KEY[key] ?? key;
      const raw = valueForDraft(key);
      const selected = tradeEventSelectionFromDraft(raw);
      const catalogIds = TRADE_SIGNAL_NOTIFY_EVENT_OPTIONS.map(
        (o: { id: string }) => o.id,
      );
      const allSelected = catalogIds.every((id) => selected.has(id));
      const setSelection = (next: Set<string>) => {
        const ordered = catalogIds.filter((id) => next.has(id));
        if (ordered.length === catalogIds.length) {
          setDraftKey(key, '');
        } else if (ordered.length === 0) {
          setDraftKey(key, '[]');
        } else {
          setDraftKey(key, JSON.stringify(ordered));
        }
      };
      return (
        <div key={key} style={{ gridColumn: '1 / -1' }}>
          <span style={{ display: 'block', marginBottom: '0.35rem' }}>{label}</span>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '0 0 0.6rem' }}>
            Работает, если включены уведомления о событиях сделки (переключатель выше). Пустое
            значение (все галочки) — слать все типы; снимите лишние — в БД сохранится JSON-массив
            id.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => setSelection(new Set(catalogIds))}
            >
              Все типы
            </button>
            <button
              type="button"
              className="btn"
              disabled={saving}
              onClick={() => setSelection(new Set())}
            >
              Ни одного
            </button>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '0.35rem 0.75rem',
              maxHeight: 'min(320px, 50vh)',
              overflowY: 'auto',
              padding: '0.5rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--card)',
            }}
          >
            {TRADE_SIGNAL_NOTIFY_EVENT_OPTIONS.map((opt: { id: string; labelRu: string }) => (
              <label
                key={opt.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.45rem',
                  fontSize: '0.88rem',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt.id)}
                  disabled={saving}
                  onChange={(e) => {
                    const next = new Set(selected);
                    if (e.target.checked) {
                      next.add(opt.id);
                    } else {
                      next.delete(opt.id);
                    }
                    setSelection(next);
                  }}
                />
                <span>
                  <code style={{ fontSize: '0.78rem' }}>{opt.id}</code>
                  <br />
                  <span style={{ color: 'var(--muted)' }}>{opt.labelRu}</span>
                </span>
              </label>
            ))}
          </div>
          {!allSelected && selected.size > 0 && (
            <p style={{ color: 'var(--muted)', fontSize: '0.75rem', marginTop: '0.35rem' }}>
              JSON: <code>{valueForDraft(key) || '[]'}</code>
            </p>
          )}
        </div>
      );
    }
    if (key === 'TP_SL_STEP_START') {
      const raw = valueForDraft(key).trim().toLowerCase();
      const legacyOn =
        valueForDraft('TP_SL_STEP_ENABLED').trim().toLowerCase() === 'true';
      const effectiveRaw =
        raw !== '' ? raw : legacyOn ? 'tp2' : 'off';
      const v = ['off', 'tp1', 'tp2', 'tp3', 'tp4', 'tp5'].includes(effectiveRaw)
        ? effectiveRaw
        : 'off';
      const label = LABEL_BY_KEY[key] ?? key;
      return (
        <label key={key} style={{ gridColumn: '1 / -1' }}>
          <span>{label}</span>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '0.35rem 0 0.5rem' }}>
            Старт: до выбранного TP лестница не двигает SL; на стартовом — безубыток, далее SL на уровни TP по полю
            «диапазон» (см. TP_SL_STEP_RANGE). Пример при диапазоне = старту: tp1 — классика (TP1→BE, TP2→TP1…);
            tp2 — как раньше по умолчанию (до TP2 не двигаем, затем BE→TP1→TP2…).
          </p>
          <select
            value={v}
            disabled={saving}
            onChange={(e) => setDraftKey(key, e.target.value)}
            style={{
              maxWidth: '520px',
              padding: '0.45rem',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
            }}
          >
            <option value="off">Выключено</option>
            <option value="tp1">С 1-го TP (классика)</option>
            <option value="tp2">Со 2-го TP</option>
            <option value="tp3">С 3-го TP</option>
            <option value="tp4">С 4-го TP</option>
            <option value="tp5">С 5-го TP</option>
          </select>
        </label>
      );
    }
    if (key === 'TP_SL_STEP_RANGE') {
      const raw = valueForDraft(key).trim();
      const v =
        raw === '' || !['1', '2', '3', '4', '5'].includes(raw) ? '' : raw;
      const label = LABEL_BY_KEY[key] ?? key;
      return (
        <label key={key} style={{ gridColumn: '1 / -1' }}>
          <span>{label}</span>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '0.35rem 0 0.5rem' }}>
            После стартового шага (безубыток) цена SL берётся у TP с номером «текущее число исполненных TP подряд
            минус диапазон минус 1» в списке TP. Пустое значение — диапазон совпадает с номером стартового TP
            (поведение по умолчанию, как до этой настройки).
          </p>
          <select
            value={v}
            disabled={saving}
            onChange={(e) => setDraftKey(key, e.target.value)}
            style={{
              maxWidth: '520px',
              padding: '0.45rem',
              borderRadius: 4,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--foreground)',
            }}
          >
            <option value="">Как у стартового TP (по умолчанию)</option>
            <option value="1">1</option>
            <option value="2">2</option>
            <option value="3">3</option>
            <option value="4">4</option>
            <option value="5">5</option>
          </select>
        </label>
      );
    }
    if (key === 'DEFAULT_ORDER_USD') {
      const raw = valueForDraft(key);
      const p = parseStoredEntry(raw);
      return (
        <div key={key} style={{ gridColumn: '1 / -1' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <span>{LABEL_BY_KEY[key] ?? key}</span>
            <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: 0 }}>
              Переключатель: номинал в USDT или доля в процентах от суммарного баланса Bybit. В поле —
              только число.
            </p>
            <EntrySizingControl
              mode={p.mode}
              amount={p.amount}
              disabled={saving}
              onChange={(m, amt) => setDraftKey(key, serializeEntry(m, amt))}
            />
          </label>
        </div>
      );
    }
    const label = LABEL_BY_KEY[key] ?? key;
    const isBoolean = BOOLEAN_KEYS.has(key);
    const isModel = MODEL_KEYS.has(key);
    return (
      <label key={key} className={isBoolean ? 'settingRowSwitch' : undefined}>
        <span>{label}</span>
        {isBoolean ? (
          <button
            type="button"
            role="switch"
            aria-checked={boolValueFor(key)}
            aria-label={label}
            className={`switch ${boolValueFor(key) ? 'on' : 'off'}`}
            disabled={saving}
            onClick={() => {
              const next = boolValueFor(key) ? 'false' : 'true';
              setDraftKey(key, next);
            }}
          >
            <span className="switchThumb" />
          </button>
        ) : (
          <input
            value={valueForDraft(key)}
            name={key}
            list={isModel ? `${key}-history` : undefined}
            autoComplete="off"
            onChange={(e) => setDraftKey(key, e.target.value)}
          />
        )}
        {isModel && modelHistory.length > 0 && (
          <>
            <datalist id={`${key}-history`}>
              {modelHistory.map((model) => (
                <option key={`${key}-${model}`} value={model} />
              ))}
            </datalist>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.4rem',
                marginTop: '0.35rem',
              }}
            >
              {modelHistory.slice(0, 8).map((model) => (
                <button
                  key={`${key}-chip-${model}`}
                  type="button"
                  disabled={saving}
                  onClick={() => setDraftKey(key, model)}
                  style={{
                    padding: '0.2rem 0.45rem',
                    fontSize: '0.75rem',
                    borderRadius: 999,
                    border: '1px solid var(--border, #444)',
                    background: 'transparent',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                  }}
                >
                  {model}
                </button>
              ))}
            </div>
          </>
        )}
      </label>
    );
  }

  return (
    <>
      <h1 className="pageTitle">Настройки</h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Значения хранятся в SQLite на сервере API. Чувствительные поля не
        отображаются в списке GET /settings (только в raw для этой страницы).
        Изменения применяются на сервере только после нажатия «Сохранить».
      </p>
      {message && (
        <p className={`msg ${message.type === 'ok' ? 'ok' : 'err'}`}>
          {message.text}
        </p>
      )}
      <div style={{ marginBottom: '0.8rem' }}>
        <button type="button" className="btn btnSecondary" onClick={() => void logout()}>
          Выйти из настроек
        </button>
      </div>
      <div className="settingsAccordion" style={{ marginTop: '0.75rem' }}>
        {SETTINGS_SECTIONS.map((section) => (
          <details key={section.id} className="card">
            <summary className="settingsSectionSummary">{section.title}</summary>
            <div className="settingsForm" style={{ marginTop: '0.9rem' }}>
              {section.keys.map((key) => renderSettingField(key))}
            </div>
          </details>
        ))}

        <details className="card">
          <summary className="settingsSectionSummary">Источники и исключения</summary>
          <div style={{ marginTop: '0.9rem' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              Управляет списком `source`, который доступен для редактирования в сделках (`/trades`)
              и отдельным списком исключений для аналитики.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={newSource}
                placeholder="добавить source, например Binance Killers"
                onChange={(e) => setNewSource(e.target.value)}
                style={{
                  flex: '1 1 260px',
                  padding: '0.5rem',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'var(--foreground)',
                }}
              />
              <button
                type="button"
                onClick={() => addSource()}
                disabled={saving || !newSource.trim()}
                className="btn"
              >
                Добавить
              </button>
            </div>
            {sourceListSorted.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
                {sourceListSorted.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => removeSource(v)}
                    style={{
                      padding: '0.2rem 0.45rem',
                      borderRadius: 999,
                      border: '1px solid var(--border, #444)',
                      background: 'transparent',
                      color: 'var(--muted)',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                      fontSize: '0.85rem',
                    }}
                    disabled={saving}
                    title="Удалить из списка"
                  >
                    {v} ×
                  </button>
                ))}
              </div>
            )}

            <div
              style={{
                marginTop: '1.5rem',
                paddingTop: '1rem',
                borderTop: '1px dashed var(--border, #333)',
              }}
            >
              <h3 style={{ fontSize: '0.95rem', marginBottom: '0.45rem' }}>
                Исключённые источники из аналитики
              </h3>
              <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.88rem' }}>
                История сделок сохраняется, но эти источники не учитываются в топах, winrate и PnL на
                дашборде.
              </p>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  value={newExcludedSource}
                  placeholder="добавить источник в исключения"
                  onChange={(e) => setNewExcludedSource(e.target.value)}
                  style={{
                    flex: '1 1 260px',
                    padding: '0.5rem',
                    borderRadius: 4,
                    border: '1px solid var(--border)',
                    background: 'var(--card)',
                    color: 'var(--foreground)',
                  }}
                />
                <button
                  type="button"
                  onClick={() => addExcludedSource()}
                  disabled={saving || !newExcludedSource.trim()}
                  className="btn btnSecondary"
                >
                  Добавить в исключения
                </button>
              </div>
              {excludedSourceListSorted.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
                  {excludedSourceListSorted.map((v) => (
                    <button
                      key={`excluded-${v}`}
                      type="button"
                      onClick={() => removeExcludedSource(v)}
                      style={{
                        padding: '0.2rem 0.45rem',
                        borderRadius: 999,
                        border: '1px solid var(--border, #444)',
                        background: 'transparent',
                        color: 'var(--muted)',
                        cursor: saving ? 'not-allowed' : 'pointer',
                        opacity: saving ? 0.7 : 1,
                        fontSize: '0.85rem',
                      }}
                      disabled={saving}
                      title="Убрать из исключений"
                    >
                      {v} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </details>

        <details className="card">
          <summary className="settingsSectionSummary">Модели для диагностики</summary>
          <div style={{ marginTop: '0.9rem' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              Эти модели используются на странице `/diagnostics` для поэтапного аудита workflow.
              Значение сохраняется в ключе `OPENROUTER_DIAGNOSTIC_MODELS`.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={newDiagnosticModel}
                placeholder="добавить модель, например openai/gpt-5.4"
                onChange={(e) => setNewDiagnosticModel(e.target.value)}
                style={{
                  flex: '1 1 260px',
                  padding: '0.5rem',
                  borderRadius: 4,
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'var(--foreground)',
                }}
              />
              <button
                type="button"
                onClick={() => addDiagnosticModel()}
                disabled={saving || !newDiagnosticModel.trim()}
                className="btn"
              >
                Добавить модель
              </button>
            </div>
            {diagnosticModelsSorted.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
                {diagnosticModelsSorted.map((model) => (
                  <button
                    key={`diagnostic-model-${model}`}
                    type="button"
                    onClick={() => removeDiagnosticModel(model)}
                    style={{
                      padding: '0.2rem 0.45rem',
                      borderRadius: 999,
                      border: '1px solid var(--border, #444)',
                      background: 'transparent',
                      color: 'var(--muted)',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                      fontSize: '0.85rem',
                    }}
                    disabled={saving}
                    title="Удалить модель из диагностики"
                  >
                    {model} ×
                  </button>
                ))}
              </div>
            )}
          </div>
        </details>

        <details className="card">
          <summary className="settingsSectionSummary">Опасная зона</summary>
          <div style={{ marginTop: '0.9rem' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              Сброс статистики не удаляет сделки, а только начинает расчет метрик заново. Полный сброс
              БД удаляет сигналы, ордера, логи и настройки в SQLite.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btnSecondary"
                disabled={resettingStats}
                onClick={() => void resetStats()}
              >
                {resettingStats ? 'Сброс статистики…' : 'Сбросить статистику'}
              </button>
              <button
                type="button"
                className="btnDanger"
                disabled={resetting}
                onClick={() => void resetDatabase()}
              >
                {resetting ? 'Сброс…' : 'Сбросить базу данных'}
              </button>
            </div>
          </div>
        </details>
      </div>

      <div
        className="card"
        style={{
          marginTop: '1.25rem',
          padding: '1rem 1.1rem',
          position: 'sticky',
          bottom: 0,
          zIndex: 2,
          boxShadow: '0 -4px 24px rgba(0,0,0,0.25)',
        }}
      >
        <h2 style={{ fontSize: '1rem', marginBottom: '0.65rem' }}>Сохранение</h2>
        {hasPendingChanges ? (
          <>
            <p style={{ color: 'var(--muted)', fontSize: '0.88rem', marginBottom: '0.6rem' }}>
              Будут записаны в SQLite следующие отличия от последнего сохранённого состояния:
            </p>
            <ul
              style={{
                margin: '0 0 0.85rem 0',
                paddingLeft: '1.2rem',
                fontSize: '0.88rem',
                maxHeight: 'min(40vh, 320px)',
                overflowY: 'auto',
              }}
            >
              {pendingChanges.map((c) => (
                <li key={c.key} style={{ marginBottom: '0.45rem' }}>
                  <strong>{c.label}</strong>
                  <div style={{ color: 'var(--muted)', marginTop: '0.15rem' }}>
                    <span style={{ textDecoration: 'line-through', opacity: 0.85 }}>{c.before}</span>
                    {' → '}
                    <span>{c.after}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', marginBottom: '0.85rem' }}>
            Нет несохранённых изменений.
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="btn"
            disabled={saving || !hasPendingChanges}
            onClick={() => void saveAll()}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
          <button
            type="button"
            className="btn btnSecondary"
            disabled={saving || !hasPendingChanges}
            onClick={revertDraft}
          >
            Отменить изменения
          </button>
        </div>
      </div>
    </>
  );
}
