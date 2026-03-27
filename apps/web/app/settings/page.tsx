'use client';

import { useEffect, useState } from 'react';

import { getApiBase } from '../../lib/api';

const MODEL_HISTORY_KEY = 'OPENROUTER_MODEL_HISTORY';
const KEYS = [
  { key: 'OPENROUTER_API_KEY', label: 'OpenRouter API key' },
  { key: 'OPENROUTER_MODEL_DEFAULT', label: 'Модель по умолчанию' },
  { key: 'OPENROUTER_MODEL_TEXT', label: 'Модель (текст)' },
  { key: 'OPENROUTER_MODEL_TEXT_FALLBACK_1', label: 'Fallback модель (текст) #1' },
  { key: 'OPENROUTER_MODEL_IMAGE', label: 'Модель (изображение)' },
  { key: 'OPENROUTER_MODEL_IMAGE_FALLBACK_1', label: 'Fallback модель (изображение) #1' },
  { key: 'OPENROUTER_MODEL_AUDIO', label: 'Модель (аудио)' },
  { key: 'OPENROUTER_MODEL_AUDIO_FALLBACK_1', label: 'Fallback модель (аудио) #1' },
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
    label:
      'Номинал позиции по умолчанию (USDT), если в сигнале нет суммы и не задан % депозита',
  },
  {
    key: 'DEFAULT_LEVERAGE_ENABLED',
    label: 'Включить кредитное плечо по умолчанию',
  },
  {
    key: 'DEFAULT_LEVERAGE',
    label: 'Кредитное плечо по умолчанию (целое число, например 10)',
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
    key: 'SIGNAL_SOURCE',
    label:
      'Источник сигналов (канал / приложение, для статистики: Binance Killers, Crypto Signals, …)',
  },
  { key: 'TELEGRAM_WHITELIST', label: 'Telegram user IDs (через запятую)' },
  { key: 'POLLING_INTERVAL_MS', label: 'Polling (0 = отключить опрос Bybit)' },
] as const;

const BOOLEAN_KEYS = new Set<string>([
  'BYBIT_TESTNET',
  'DEFAULT_LEVERAGE_ENABLED',
  'TELEGRAM_USERBOT_ENABLED',
  'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
  'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION',
  'TELEGRAM_USERBOT_NOTIFY_FAILURES',
]);
const MODEL_KEYS = new Set<string>(
  KEYS.map(({ key }) => key).filter((key) => key.startsWith('OPENROUTER_MODEL_')),
);
const LABEL_BY_KEY = Object.fromEntries(KEYS.map(({ key, label }) => [key, label])) as Record<
  string,
  string
>;
const SETTINGS_SECTIONS: { id: string; title: string; keys: string[] }[] = [
  {
    id: 'openrouter',
    title: 'OpenRouter',
    keys: [
      'OPENROUTER_API_KEY',
      'OPENROUTER_MODEL_DEFAULT',
      'OPENROUTER_MODEL_TEXT',
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
    keys: ['MIN_CAPITAL_AMOUNT', 'DEFAULT_ORDER_USD', 'DEFAULT_LEVERAGE_ENABLED', 'DEFAULT_LEVERAGE', 'POLLING_INTERVAL_MS'],
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
      'SIGNAL_SOURCE',
      'TELEGRAM_WHITELIST',
    ],
  },
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

export default function SettingsPage() {
  const [rows, setRows] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [resetting, setResetting] = useState(false);
  const [resettingStats, setResettingStats] = useState(false);
  const [newSource, setNewSource] = useState('');
  const [newExcludedSource, setNewExcludedSource] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${getApiBase()}/settings/raw`);
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as {
          settings: { key: string; value: string }[];
        };
        setRows(j.settings ?? []);
      } catch {
        setMessage({ type: 'err', text: 'Не удалось загрузить настройки' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const valueFor = (key: string) => rows.find((r) => r.key === key)?.value ?? '';
  const boolValueFor = (key: string) => valueFor(key).toLowerCase() === 'true';
  const modelHistory = parseModelHistory(valueFor(MODEL_HISTORY_KEY));

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
    // Fallback: split by newline/comma
    return t
      .split(/[\n,]/g)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }

  const sourceList = parseStringList(valueFor('SOURCE_LIST'));
  const sourceListSorted = Array.from(new Set(sourceList)).sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
  const excludedSourceList = parseStringList(valueFor('SOURCE_EXCLUDE_LIST'));
  const excludedSourceListSorted = Array.from(new Set(excludedSourceList)).sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

  function upsertRow(
    list: { key: string; value: string }[],
    key: string,
    value: string,
  ) {
    const i = list.findIndex((r) => r.key === key);
    if (i >= 0) {
      const next = [...list];
      next[i] = { key, value };
      return next;
    }
    return [...list, { key, value }];
  }

  async function save(key: string, value: string) {
    setSaving(key);
    setMessage(null);
    try {
      const res = await fetch(`${getApiBase()}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      let nextRows = upsertRow(rows, key, value);

      if (MODEL_KEYS.has(key) && value.trim()) {
        const nextHistory = mergeModelHistory(modelHistory, value);
        const nextHistoryRaw = JSON.stringify(nextHistory);
        if (nextHistoryRaw !== valueFor(MODEL_HISTORY_KEY)) {
          const historyRes = await fetch(`${getApiBase()}/settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              key: MODEL_HISTORY_KEY,
              value: nextHistoryRaw,
            }),
          });
          if (!historyRes.ok) throw new Error(String(historyRes.status));
          nextRows = upsertRow(nextRows, MODEL_HISTORY_KEY, nextHistoryRaw);
        }
      }

      setRows(nextRows);
      setMessage({ type: 'ok', text: 'Сохранено' });
    } catch {
      setMessage({ type: 'err', text: 'Ошибка сохранения' });
    } finally {
      setSaving(null);
    }
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
      setRows([]);
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

  async function addSource() {
    const v = newSource.trim();
    if (!v) return;
    const next = Array.from(new Set([...sourceListSorted, v]));
    const raw = JSON.stringify(next);
    setNewSource('');
    await save('SOURCE_LIST', raw);
  }

  async function removeSource(v: string) {
    const next = sourceListSorted.filter((x) => x !== v);
    const raw = JSON.stringify(next);
    await save('SOURCE_LIST', raw);
  }

  async function addExcludedSource() {
    const v = newExcludedSource.trim();
    if (!v) return;
    const next = Array.from(new Set([...excludedSourceListSorted, v]));
    const raw = JSON.stringify(next);
    setNewExcludedSource('');
    await save('SOURCE_EXCLUDE_LIST', raw);
  }

  async function removeExcludedSource(v: string) {
    const next = excludedSourceListSorted.filter((x) => x !== v);
    const raw = JSON.stringify(next);
    await save('SOURCE_EXCLUDE_LIST', raw);
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

  function renderSettingField(key: string) {
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
            disabled={saving === key}
            onClick={() => {
              const next = boolValueFor(key) ? 'false' : 'true';
              void save(key, next);
            }}
          >
            <span className="switchThumb" />
          </button>
        ) : (
          <input
            key={`${key}:${valueFor(key)}`}
            defaultValue={valueFor(key)}
            name={key}
            list={isModel ? `${key}-history` : undefined}
            autoComplete="off"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== valueFor(key)) void save(key, v);
            }}
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
                  disabled={saving === key}
                  onClick={() => void save(key, model)}
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
        {saving === key && (
          <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
            сохранение…
          </span>
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
      </p>
      {message && (
        <p className={`msg ${message.type === 'ok' ? 'ok' : 'err'}`}>
          {message.text}
        </p>
      )}
      <div className="settingsAccordion" style={{ marginTop: '0.75rem' }}>
        {SETTINGS_SECTIONS.map((section, idx) => (
          <details key={section.id} className="card" open={idx === 0}>
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
                onClick={() => void addSource()}
                disabled={saving === 'SOURCE_LIST' || !newSource.trim()}
                className="btn"
              >
                {saving === 'SOURCE_LIST' ? 'Добавление…' : 'Добавить'}
              </button>
            </div>
            {sourceListSorted.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
                {sourceListSorted.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => void removeSource(v)}
                    style={{
                      padding: '0.2rem 0.45rem',
                      borderRadius: 999,
                      border: '1px solid var(--border, #444)',
                      background: 'transparent',
                      color: 'var(--muted)',
                      cursor: saving === 'SOURCE_LIST' ? 'not-allowed' : 'pointer',
                      opacity: saving === 'SOURCE_LIST' ? 0.7 : 1,
                      fontSize: '0.85rem',
                    }}
                    disabled={saving === 'SOURCE_LIST'}
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
                  onClick={() => void addExcludedSource()}
                  disabled={saving === 'SOURCE_EXCLUDE_LIST' || !newExcludedSource.trim()}
                  className="btn btnSecondary"
                >
                  {saving === 'SOURCE_EXCLUDE_LIST' ? 'Добавление…' : 'Добавить в исключения'}
                </button>
              </div>
              {excludedSourceListSorted.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}>
                  {excludedSourceListSorted.map((v) => (
                    <button
                      key={`excluded-${v}`}
                      type="button"
                      onClick={() => void removeExcludedSource(v)}
                      style={{
                        padding: '0.2rem 0.45rem',
                        borderRadius: 999,
                        border: '1px solid var(--border, #444)',
                        background: 'transparent',
                        color: 'var(--muted)',
                        cursor: saving === 'SOURCE_EXCLUDE_LIST' ? 'not-allowed' : 'pointer',
                        opacity: saving === 'SOURCE_EXCLUDE_LIST' ? 0.7 : 1,
                        fontSize: '0.85rem',
                      }}
                      disabled={saving === 'SOURCE_EXCLUDE_LIST'}
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
    </>
  );
}
