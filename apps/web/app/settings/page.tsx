'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import {
  CABINET_SCOPED_SETTING_KEY_SET,
  NAV_MENU_HIDDEN_SETTING_KEY,
  NAV_MENU_ITEMS,
  TRADE_SIGNAL_NOTIFY_EVENT_OPTIONS,
} from '@repo/shared';

import { EntrySizingControl } from '../components/EntrySizingControl';
import { fetchApiResponse } from '../../lib/api';
import { parseStoredEntry, serializeEntry } from '../../lib/entry-sizing';
import type { PendingChange, Row } from './settings.types';
import {
  ADMIN_GLOBAL_KEYS,
  BOOLEAN_KEYS,
  DIAGNOSTIC_MODELS_KEY,
  KEYS,
  LABEL_BY_KEY,
  MODEL_HISTORY_KEY,
  MODEL_KEYS,
  SETTINGS_SECTIONS,
} from './settings-page.constants';
import {
  buildPutOperations,
  collectPendingChanges,
  labelForKey,
  parseModelHistory,
  tpSlStepStartSelectFromDraft,
  upsertRow,
  valueFor,
  withAppBasePath,
} from './settings-page.util';

export default function SettingsPage() {
  const searchParams = useSearchParams();
  const requestedScope = searchParams.get('scope') === 'account' ? 'account' : 'cabinet';
  const [savedRows, setSavedRows] = useState<Row[]>([]);
  const [draftRows, setDraftRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [authChecking, setAuthChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authLogin, setAuthLogin] = useState('');
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
  const scope = !isAdmin && requestedScope === 'account' ? 'cabinet' : requestedScope;

  const apiFetchScoped = useCallback(
    (path: string, init?: RequestInit) =>
      fetchApiResponse(path, init, scope === 'account' ? '' : undefined),
    [scope],
  );

  const visibleKeys = useMemo(
    () =>
      KEYS.filter(({ key }) => {
        if (scope === 'account') {
          return isAdmin && ADMIN_GLOBAL_KEYS.has(key);
        }
        if (scope === 'cabinet') {
          if (!CABINET_SCOPED_SETTING_KEY_SET.has(key)) return false;
          if (!isAdmin && ADMIN_GLOBAL_KEYS.has(key)) return false;
          return true;
        }
        return false;
      }),
    [scope, isAdmin],
  );
  const visibleKeySet = useMemo(() => new Set<string>(visibleKeys.map(({ key }) => key)), [visibleKeys]);
  const visibleSections = useMemo(
    () =>
      SETTINGS_SECTIONS.map((section) => ({
        ...section,
        keys: section.keys.filter((key) =>
          scope === 'cabinet'
            ? CABINET_SCOPED_SETTING_KEY_SET.has(key)
            : !CABINET_SCOPED_SETTING_KEY_SET.has(key),
        ),
      }))
        .filter((section) => section.keys.length > 0)
        .filter((section) =>
          isAdmin ? true : !['ui', 'openrouter', 'trading', 'diagnostics'].includes(section.id),
        ),
    [scope, isAdmin],
  );

  const loadSettings = useCallback(async () => {
    try {
      const res = await apiFetchScoped('/settings/effective');
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
  }, [apiFetchScoped]);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(withAppBasePath('/api/auth'));
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as {
          authenticated: boolean;
          enabled?: boolean;
          role?: string;
        };
        setAuthenticated(Boolean(j.authenticated));
        setIsAdmin(String(j.role ?? '').trim().toLowerCase() === 'admin');
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
  }, [scope, loadSettings]);

  const pendingChanges = useMemo(() => {
    const all = collectPendingChanges(savedRows, draftRows);
    return all.filter((c) => {
      if (visibleKeySet.has(c.key)) return true;
      if (scope === 'account') {
        return c.key === DIAGNOSTIC_MODELS_KEY || c.key === MODEL_HISTORY_KEY;
      }
      if (scope === 'cabinet') {
        return c.key === 'SOURCE_LIST' || c.key === 'SOURCE_EXCLUDE_LIST';
      }
      return false;
    });
  }, [savedRows, draftRows, scope, visibleKeySet]);
  const hasPendingChanges = pendingChanges.length > 0;

  const valueForDraft = (key: string) => valueFor(draftRows, key);
  const boolValueFor = (key: string) => {
    const raw = valueForDraft(key).trim().toLowerCase();
    if (key === 'APPLOG_ENABLED') {
      if (raw === '') return true;
      return raw === 'true';
    }
    return raw === 'true';
  };
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
      const ops = buildPutOperations(savedRows, draftRows).filter(({ key }) => {
        if (visibleKeySet.has(key)) return true;
        if (scope === 'account') {
          return key === DIAGNOSTIC_MODELS_KEY || key === MODEL_HISTORY_KEY;
        }
        if (scope === 'cabinet') {
          return key === 'SOURCE_LIST' || key === 'SOURCE_EXCLUDE_LIST';
        }
        return false;
      });
    if (ops.length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      let next = [...savedRows];
      for (const { key, value } of ops) {
        const res = await apiFetchScoped('/settings', {
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
        if (key === 'TP_SL_STEP_RANGE' || key === 'TP_SL_STEP_START') {
          storedValue = value.trim();
        } else if (
          (key === 'SOURCE_TP_SL_STEP_RANGE' || key === 'SOURCE_TP_SL_STEP_START') &&
          value.trim() === ''
        ) {
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
      'Удалить все данные в PostgreSQL на сервере API?\n\n' +
        'Будут удалены: сигналы, ордера, логи и сохранённые в БД настройки (ключи, токены и т.д.).\n' +
        'Переменные из .env не затрагиваются.',
    );
    if (!ok) {
      return;
    }
    setResetting(true);
    setMessage(null);
    try {
      const res = await apiFetchScoped('/settings/reset-database', {
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
      const res = await apiFetchScoped('/orders/reset-stats', {
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
      const res = await fetch(withAppBasePath('/api/auth'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: authLogin, password: authPassword }),
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
    await fetch(withAppBasePath('/api/auth'), { method: 'DELETE' }).catch(
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
            Войдите в общий аккаунт.
          </p>
          {authError && <p className="msg err">{authError}</p>}
          <div className="settingsAuthForm">
            <input
              className="settingsAuthInput"
              type="text"
              value={authLogin}
              autoComplete="username"
              placeholder="Введите логин"
              onChange={(e) => setAuthLogin(e.target.value)}
            />
            <input
              className="settingsAuthInput"
              type="password"
              value={authPassword}
              autoComplete="current-password"
              placeholder="Введите пароль"
              onChange={(e) => setAuthPassword(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  !authSubmitting &&
                  authPassword.trim() &&
                  authLogin.trim()
                ) {
                  void submitPassword();
                }
              }}
            />
            <button
              type="button"
              className="btn"
              disabled={authSubmitting || !authPassword.trim() || !authLogin.trim()}
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
    if (key === NAV_MENU_HIDDEN_SETTING_KEY) {
      const currentSet = (() => {
        const raw = valueForDraft(key).trim();
        if (!raw) return new Set<string>();
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return new Set<string>();
          return new Set<string>(parsed.map((x) => String(x)));
        } catch {
          return new Set<string>();
        }
      })();
      const toggleItem = (id: string) => {
        const next = new Set(currentSet);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        const ordered = NAV_MENU_ITEMS.map((i) => i.id).filter((id2) => next.has(id2));
        setDraftKey(key, JSON.stringify(ordered));
      };
      return (
        <div key={key} style={{ gridColumn: '1 / -1' }}>
          <span style={{ display: 'block', marginBottom: '0.35rem' }}>{LABEL_BY_KEY[key] ?? key}</span>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '0 0 0.6rem' }}>
            Отмеченные пункты будут скрыты из верхней панели и показаны только в бургер-меню.
          </p>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '0.35rem 0.75rem',
              padding: '0.5rem',
              border: '1px solid var(--border)',
              borderRadius: 6,
              background: 'var(--card)',
            }}
          >
            {NAV_MENU_ITEMS.map((item) => (
              <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <input
                  type="checkbox"
                  checked={currentSet.has(item.id)}
                  disabled={saving || (item.id === 'dashboard' || item.id === 'trades')}
                  onChange={() => toggleItem(item.id)}
                />
                <span style={{ color: 'var(--foreground)', fontSize: '0.88rem' }}>
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      );
    }
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
      const legacyOn =
        valueForDraft('TP_SL_STEP_ENABLED').trim().toLowerCase() === 'true';
      const { value: v, invalidDraft } = tpSlStepStartSelectFromDraft(
        valueForDraft(key),
        legacyOn,
      );
      const label = LABEL_BY_KEY[key] ?? key;
      return (
        <label key={key} style={{ gridColumn: '1 / -1' }}>
          <span>{label}</span>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '0.35rem 0 0.5rem' }}>
            Считаем только тейки подряд с TP1. Пока исполнено меньше, чем выбранный старт — SL не трогаем. Когда
            исполнен N‑й подряд (N = этот выбор: 1 — с TP1, 2 — с TP2…) — переводим SL в безубыток. Каждый следующий
            исполненный тейк: куда подтянуть SL — поле ниже «глубина» (ключ TP_SL_STEP_RANGE).
          </p>
          {invalidDraft ? (
            <p
              style={{
                color: 'var(--foreground)',
                fontSize: '0.82rem',
                margin: '0.35rem 0 0.25rem',
                padding: '0.35rem 0.5rem',
                borderLeft: '3px solid #f59e0b',
                background: 'color-mix(in srgb, #f59e0b 12%, transparent)',
              }}
            >
              В черновике неподдерживаемое значение: <code>{valueForDraft(key).trim() || '∅'}</code>. Выберите режим
              ниже и сохраните — иначе при сохранении API отклонит строку.
            </p>
          ) : null}
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
            Пусть k — сколько тейков подряд с TP1 уже исполнено, N — номер старта из поля выше (1…5). При k = N SL
            переведён в безубыток. При k &gt; N цену SL берём у тейка с порядковым номером k − глубина (TP1 — ближайший
            к входу, TP2 — следующий и т.д. после сортировки для лонга/шорта).
          </p>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '0.25rem 0 0.5rem' }}>
            Первый пункт списка: глубина автоматически равна N — как раньше без отдельной настройки. Пример: старт с TP2
            и Авто — после 2‑го тейка BE, после 3‑го SL на TP1, после 4‑го на TP2. Цифры 1…5 задают свою глубину
            (пример: старт с TP2 и глубина 1 — после 3‑го тейка SL сразу на TP2).
          </p>
          <p style={{ color: 'var(--muted)', fontSize: '0.88rem', margin: '0.25rem 0 0.5rem' }}>
            Если глубина большая, в первых шагах после безубытка число k − глубина может быть меньше 1 — тогда SL остаётся
            на безубытке, пока k не вырастет (отдельные шаги лестницы на бирже могут не вызываться).
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
            <option value="">
              Авто: глубина = номер старта (как раньше без этого поля)
            </option>
            <option value="1">Глубина 1</option>
            <option value="2">Глубина 2</option>
            <option value="3">Глубина 3</option>
            <option value="4">Глубина 4</option>
            <option value="5">Глубина 5</option>
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
      <h1 className="pageTitle">
        {scope === 'account' ? 'Настройки аккаунта (глобальные)' : 'Настройки кабинета'}
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Значения хранятся в PostgreSQL на сервере API. Глобальные настройки работают как
        значения по умолчанию для всех кабинетов, а в режиме кабинета меняются только
        cabinet-scoped override-поля.
      </p>
      <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '0.9rem' }}>
        <a className={`btn ${scope === 'cabinet' ? '' : 'btnSecondary'}`} href={withAppBasePath('/settings?scope=cabinet')}>
          Режим: Кабинет
        </a>
        {isAdmin ? (
          <a className={`btn ${scope === 'account' ? '' : 'btnSecondary'}`} href={withAppBasePath('/settings?scope=account')}>
            Режим: Аккаунт (глобально)
          </a>
        ) : null}
      </div>
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
        {visibleSections.map((section) => (
          <details key={section.id} className="card">
            <summary className="settingsSectionSummary">{section.title}</summary>
            <div className="settingsForm" style={{ marginTop: '0.9rem' }}>
              {section.keys.map((key) => renderSettingField(key))}
            </div>
          </details>
        ))}

        {scope === 'cabinet' ? (
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
        ) : null}

        {scope === 'account' && isAdmin ? (
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
        ) : null}

        {isAdmin ? (
        <details className="card">
          <summary className="settingsSectionSummary">Опасная зона</summary>
          <div style={{ marginTop: '0.9rem' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              Сброс статистики не удаляет сделки, а только начинает расчет метрик заново. Полный сброс
              БД удаляет сигналы, ордера, логи и настройки в PostgreSQL.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              {scope === 'cabinet' ? (
                <button
                  type="button"
                  className="btn btnSecondary"
                  disabled={resettingStats}
                  onClick={() => void resetStats()}
                >
                  {resettingStats ? 'Сброс статистики…' : 'Сбросить статистику кабинета'}
                </button>
              ) : null}
              {scope === 'account' ? (
                <button
                  type="button"
                  className="btnDanger"
                  disabled={resetting}
                  onClick={() => void resetDatabase()}
                >
                  {resetting ? 'Сброс…' : 'Сбросить всю базу данных'}
                </button>
              ) : null}
            </div>
          </div>
        </details>
        ) : null}
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
              Будут записаны в PostgreSQL следующие отличия от последнего сохранённого состояния:
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
