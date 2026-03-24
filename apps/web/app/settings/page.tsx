'use client';

import { useEffect, useState } from 'react';

import { getApiBase } from '../../lib/api';

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
  { key: 'TELEGRAM_USERBOT_USE_AI_CLASSIFIER', label: 'Userbot: AI-классификация сообщений (true/false)' },
  { key: 'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION', label: 'Userbot: требовать подтверждение перед размещением (true/false)' },
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

export default function SettingsPage() {
  const [rows, setRows] = useState<{ key: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [resetting, setResetting] = useState(false);

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
      setRows((prev) => {
        const i = prev.findIndex((r) => r.key === key);
        if (i >= 0) {
          const next = [...prev];
          next[i] = { key, value };
          return next;
        }
        return [...prev, { key, value }];
      });
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
      <div className="settingsForm">
        {KEYS.map(({ key, label }) => {
          const isBoolean = BOOLEAN_KEYS.has(key);
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
                  defaultValue={valueFor(key)}
                  name={key}
                  autoComplete="off"
                  onBlur={(e) => {
                    const v = e.target.value.trim();
                    if (v !== valueFor(key)) void save(key, v);
                  }}
                />
              )}
              {saving === key && (
                <span style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                  сохранение…
                </span>
              )}
            </label>
          );
        })}
      </div>
      <div
        style={{
          marginTop: '2rem',
          paddingTop: '1.5rem',
          borderTop: '1px solid var(--border, #333)',
        }}
      >
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
          Опасная зона
        </h2>
        <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
          Полная очистка таблиц SQLite (сигналы, ордера, AppLog, ключи в БД).
          Не влияет на файлы .env.
        </p>
        <button
          type="button"
          className="btnDanger"
          disabled={resetting}
          onClick={() => void resetDatabase()}
        >
          {resetting ? 'Сброс…' : 'Сбросить базу данных'}
        </button>
      </div>
    </>
  );
}
