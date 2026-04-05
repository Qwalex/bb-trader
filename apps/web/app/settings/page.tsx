'use client';

import { useEffect, useMemo, useState } from 'react';

import { EntrySizingControl } from '../components/EntrySizingControl';
import { getApiBase } from '../../lib/api';
import { parseStoredEntry, serializeEntry } from '../../lib/entry-sizing';

import {
  BOOLEAN_KEYS,
  DIAGNOSTIC_MODELS_KEY,
  EXTRA_LABELS,
  KEYS,
  LABEL_BY_KEY,
  mergeModelHistory,
  MODEL_HISTORY_KEY,
  MODEL_KEYS,
  parseModelHistory,
  PUT_ORDER,
  SETTINGS_SECTIONS,
  labelForKey,
} from './settings-fields';

import { NAV_ITEMS } from '../../lib/nav-items';

const NAV_MENU_IN_BURGER_KEY = 'NAV_MENU_IN_BURGER';
const SETTINGS_KEYS_ADMIN_ONLY_KEY = 'SETTINGS_KEYS_ADMIN_ONLY';

function parseJsonKeyArray(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const p = JSON.parse(raw) as unknown;
    if (!Array.isArray(p)) return [];
    return p
      .map((x) => (typeof x === 'string' ? x.trim() : ''))
      .filter((x) => x.length > 0);
  } catch {
    return [];
  }
}

type Row = { key: string; value: string };
type SelectedRow = {
  key: string;
  value: string;
  sensitive?: boolean;
  configured?: boolean;
};
type SensitiveMode = 'keep' | 'replace' | 'clear';

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

/** Нормализованное JSON для сравнения: пустая строка и «битый» JSON ≡ []. */
function canonicalModelHistoryJson(raw: string): string {
  return JSON.stringify(parseModelHistory(raw));
}

function isSensitiveKey(key: string): boolean {
  const u = key.toUpperCase();
  return (
    u.includes('SECRET') ||
    u.includes('TOKEN') ||
    u.includes('PASSWORD') ||
    u.includes('API_KEY') ||
    u.includes('API_HASH') ||
    u.includes('2FA')
  );
}

/** Секреты с выбором «не менять / записать / очистить»; OpenRouter key — обычное поле без этого шага. */
function usesSensitiveSaveUi(key: string): boolean {
  return isSensitiveKey(key) && key !== 'OPENROUTER_API_KEY';
}

function formatPreviewValue(key: string, value: string): string {
  if (!value) return '(пусто)';
  if (key === MODEL_HISTORY_KEY && canonicalModelHistoryJson(value) === '[]') {
    return '(пусто)';
  }
  if (isSensitiveKey(key)) return '•••• (скрыто)';
  const t = value.length > 200 ? `${value.slice(0, 200)}…` : value;
  return t;
}

function beforeSensitivePreview(configured: boolean): string {
  return configured ? '•••• (настроено)' : '(пусто)';
}

function afterSensitivePreview(mode: SensitiveMode, value: string, configured: boolean): string {
  if (mode === 'clear') {
    return '(будет очищено)';
  }
  if (mode === 'replace' && value.trim()) {
    return '•••• (новое значение)';
  }
  return beforeSensitivePreview(configured);
}

type PendingChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};

function collectPendingChanges(
  saved: Row[],
  draft: Row[],
  sensitiveConfigured: Record<string, boolean>,
  sensitiveDrafts: Record<string, string>,
  sensitiveModes: Record<string, SensitiveMode>,
  hiddenFromUser: Set<string>,
): PendingChange[] {
  const out: PendingChange[] = [];

  for (const { key } of KEYS) {
    if (hiddenFromUser.has(key)) continue;
    if (usesSensitiveSaveUi(key)) {
      const mode = sensitiveModes[key] ?? 'keep';
      const nextValue = sensitiveDrafts[key] ?? '';
      if (mode === 'keep' || (mode === 'replace' && !nextValue.trim())) continue;
      out.push({
        key,
        label: labelForKey(key),
        before: beforeSensitivePreview(Boolean(sensitiveConfigured[key])),
        after: afterSensitivePreview(mode, nextValue, Boolean(sensitiveConfigured[key])),
      });
      continue;
    }
    if (normCompare(valueFor(draft, key), valueFor(saved, key))) continue;
    out.push({
      key,
      label: labelForKey(key),
      before: formatPreviewValue(key, valueFor(saved, key)),
      after: formatPreviewValue(key, valueFor(draft, key)),
    });
  }

  for (const ek of ['SOURCE_LIST', 'SOURCE_EXCLUDE_LIST', DIAGNOSTIC_MODELS_KEY] as const) {
    if (hiddenFromUser.has(ek)) continue;
    if (normCompare(valueFor(draft, ek), valueFor(saved, ek))) continue;
    out.push({
      key: ek,
      label: labelForKey(ek),
      before: formatPreviewValue(ek, valueFor(saved, ek)),
      after: formatPreviewValue(ek, valueFor(draft, ek)),
    });
  }

  if (!hiddenFromUser.has(MODEL_HISTORY_KEY)) {
    const nextHist = computeNextModelHistoryString(saved, draft);
    const savedHistCanonical = canonicalModelHistoryJson(valueFor(saved, MODEL_HISTORY_KEY));
    if (!normCompare(nextHist, savedHistCanonical)) {
      out.push({
        key: MODEL_HISTORY_KEY,
        label: labelForKey(MODEL_HISTORY_KEY),
        before: formatPreviewValue(MODEL_HISTORY_KEY, savedHistCanonical),
        after: formatPreviewValue(MODEL_HISTORY_KEY, nextHist),
      });
    }
  }

  const orderKey = (k: string) => {
    const i = PUT_ORDER.indexOf(k);
    return i >= 0 ? i : 999;
  };
  return [...out].sort((a, b) => orderKey(a.key) - orderKey(b.key));
}

function buildPutOperations(
  saved: Row[],
  draft: Row[],
  sensitiveDrafts: Record<string, string>,
  sensitiveModes: Record<string, SensitiveMode>,
  hiddenFromUser: Set<string>,
): { key: string; value: string }[] {
  const ops: { key: string; value: string }[] = [];

  for (const { key } of KEYS) {
    if (hiddenFromUser.has(key)) continue;
    if (usesSensitiveSaveUi(key)) {
      const mode = sensitiveModes[key] ?? 'keep';
      const value = sensitiveDrafts[key] ?? '';
      if (mode === 'replace' && value.trim()) {
        ops.push({ key, value: value.trim() });
      } else if (mode === 'clear') {
        ops.push({ key, value: '' });
      }
      continue;
    }
    if (normCompare(valueFor(draft, key), valueFor(saved, key))) continue;
    ops.push({ key, value: valueFor(draft, key).trim() });
  }

  for (const ek of ['SOURCE_LIST', 'SOURCE_EXCLUDE_LIST', DIAGNOSTIC_MODELS_KEY] as const) {
    if (hiddenFromUser.has(ek)) continue;
    if (normCompare(valueFor(draft, ek), valueFor(saved, ek))) continue;
    ops.push({ key: ek, value: valueFor(draft, ek) });
  }

  if (!hiddenFromUser.has(MODEL_HISTORY_KEY)) {
    const nextHist = computeNextModelHistoryString(saved, draft);
    const savedHistCanonical = canonicalModelHistoryJson(valueFor(saved, MODEL_HISTORY_KEY));
    if (!normCompare(nextHist, savedHistCanonical)) {
      ops.push({ key: MODEL_HISTORY_KEY, value: nextHist });
    }
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
  const [sensitiveConfigured, setSensitiveConfigured] = useState<Record<string, boolean>>({});
  const [sensitiveDrafts, setSensitiveDrafts] = useState<Record<string, string>>({});
  const [sensitiveModes, setSensitiveModes] = useState<Record<string, SensitiveMode>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null,
  );
  const [resetting, setResetting] = useState(false);
  const [resettingStats, setResettingStats] = useState(false);
  const [newSource, setNewSource] = useState('');
  const [newExcludedSource, setNewExcludedSource] = useState('');
  const [newDiagnosticModel, setNewDiagnosticModel] = useState('');
  const [appIsAdmin, setAppIsAdmin] = useState(false);
  const [hiddenSettingKeys, setHiddenSettingKeys] = useState<Set<string>>(() => new Set());
  const [navInBurgerDraft, setNavInBurgerDraft] = useState<Set<string>>(() => new Set());
  const [adminOnlyKeysDraft, setAdminOnlyKeysDraft] = useState<Set<string>>(() => new Set());
  const [navMenuSaving, setNavMenuSaving] = useState(false);
  const [adminKeysSaving, setAdminKeysSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const uiRes = await fetch(`${getApiBase()}/settings/ui`);
        if (!uiRes.ok) throw new Error('settings ui failed');
        const uiJson = (await uiRes.json()) as {
          appRole?: string;
          navMenuInBurger?: string[];
          settingsKeysAdminOnly?: string[];
        };
        const hidden = new Set(
          (uiJson.settingsKeysAdminOnly ?? []).map((k) => String(k).trim()).filter(Boolean),
        );
        const isAdmin = uiJson.appRole === 'admin';
        setAppIsAdmin(isAdmin);
        setHiddenSettingKeys(hidden);
        setNavInBurgerDraft(
          new Set(
            (uiJson.navMenuInBurger ?? []).map((x) => String(x).trim()).filter(Boolean),
          ),
        );

        const mainKeys = PUT_ORDER.filter((k) => !hidden.has(k));
        const selectedKeyList = [
          ...new Set([
            ...mainKeys,
            ...(isAdmin ? [SETTINGS_KEYS_ADMIN_ONLY_KEY] : []),
          ]),
        ];
        const selectedKeys = selectedKeyList.join(',');
        const [selectedRes, sensitiveRes] = await Promise.all([
          selectedKeyList.length > 0
            ? fetch(`${getApiBase()}/settings/selected?keys=${encodeURIComponent(selectedKeys)}`)
            : Promise.resolve(new Response(JSON.stringify({ settings: [] }), { status: 200 })),
          fetch(`${getApiBase()}/settings/sensitive-status`),
        ]);
        if (!selectedRes.ok || !sensitiveRes.ok) throw new Error('settings load failed');
        const selectedJson = (await selectedRes.json()) as { settings: SelectedRow[] };
        const sensitiveJson = (await sensitiveRes.json()) as {
          settings: Array<{ key: string; configured: boolean }>;
        };
        const rows = (selectedJson.settings ?? []).map((row) => ({
          key: row.key,
          value: row.sensitive ? '' : row.value,
        }));
        const adminOnlyRow = rows.find((r) => r.key === SETTINGS_KEYS_ADMIN_ONLY_KEY);
        const list = rows.filter((r) => r.key !== SETTINGS_KEYS_ADMIN_ONLY_KEY);
        if (isAdmin && adminOnlyRow) {
          setAdminOnlyKeysDraft(new Set(parseJsonKeyArray(adminOnlyRow.value)));
        } else {
          setAdminOnlyKeysDraft(new Set());
        }
        setSavedRows(list);
        setDraftRows(list);
        setSensitiveConfigured(
          Object.fromEntries(
            (sensitiveJson.settings ?? []).map((row) => [row.key, row.configured]),
          ) as Record<string, boolean>,
        );
        setSensitiveDrafts({});
        setSensitiveModes({});
      } catch {
        setMessage({ type: 'err', text: 'Не удалось загрузить настройки' });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pendingChanges = useMemo(
    () =>
      collectPendingChanges(
        savedRows,
        draftRows,
        sensitiveConfigured,
        sensitiveDrafts,
        sensitiveModes,
        hiddenSettingKeys,
      ),
    [
      savedRows,
      draftRows,
      sensitiveConfigured,
      sensitiveDrafts,
      sensitiveModes,
      hiddenSettingKeys,
    ],
  );

  const settingsSectionsVisible = useMemo(
    () =>
      SETTINGS_SECTIONS.map((section) => ({
        ...section,
        keys: section.keys.filter((k) => !hiddenSettingKeys.has(k)),
      })).filter((section) => section.keys.length > 0),
    [hiddenSettingKeys],
  );
  const hasPendingChanges = pendingChanges.length > 0;

  const valueForDraft = (key: string) => valueFor(draftRows, key);
  const boolValueFor = (key: string) => valueForDraft(key).toLowerCase() === 'true';
  const modelHistoryRaw = valueForDraft(MODEL_HISTORY_KEY);
  const modelHistory = useMemo(() => parseModelHistory(modelHistoryRaw), [modelHistoryRaw]);

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

  function setSensitiveDraftKey(key: string, value: string) {
    setSensitiveDrafts((prev) => ({ ...prev, [key]: value }));
    setSensitiveModes((prev) => ({
      ...prev,
      [key]: value.trim().length > 0 ? 'replace' : prev[key] ?? 'keep',
    }));
  }

  function setSensitiveMode(key: string, mode: SensitiveMode) {
    setSensitiveModes((prev) => ({ ...prev, [key]: mode }));
    if (mode !== 'replace') {
      setSensitiveDrafts((prev) => ({ ...prev, [key]: '' }));
    }
  }

  async function saveAll() {
    const ops = buildPutOperations(
      savedRows,
      draftRows,
      sensitiveDrafts,
      sensitiveModes,
      hiddenSettingKeys,
    );
    if (ops.length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      let next = [...savedRows];
      const nextConfigured = { ...sensitiveConfigured };
      for (const { key, value } of ops) {
        const res = await fetch(`${getApiBase()}/settings`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) throw new Error(String(res.status));
        next = upsertRow(next, key, isSensitiveKey(key) ? '' : value);
        if (isSensitiveKey(key)) {
          nextConfigured[key] = value.trim().length > 0;
        }
      }
      setSavedRows(next);
      setDraftRows(next);
      setSensitiveConfigured(nextConfigured);
      setSensitiveDrafts({});
      setSensitiveModes({});
      setMessage({ type: 'ok', text: 'Настройки сохранены' });
    } catch {
      setMessage({ type: 'err', text: 'Ошибка сохранения' });
    } finally {
      setSaving(false);
    }
  }

  function revertDraft() {
    setDraftRows([...savedRows]);
    setSensitiveDrafts({});
    setSensitiveModes({});
    setMessage(null);
  }

  async function saveNavMenuConfig() {
    setNavMenuSaving(true);
    setMessage(null);
    try {
      const payload = JSON.stringify([...navInBurgerDraft].sort());
      const res = await fetch(`${getApiBase()}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: NAV_MENU_IN_BURGER_KEY, value: payload }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setMessage({
        type: 'ok',
        text: 'Меню сохранено. При необходимости обновите страницу, чтобы обновить шапку.',
      });
    } catch {
      setMessage({ type: 'err', text: 'Не удалось сохранить меню' });
    } finally {
      setNavMenuSaving(false);
    }
  }

  async function saveAdminOnlyKeysConfig() {
    setAdminKeysSaving(true);
    setMessage(null);
    try {
      const payload = JSON.stringify([...adminOnlyKeysDraft].sort());
      const res = await fetch(`${getApiBase()}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: SETTINGS_KEYS_ADMIN_ONLY_KEY, value: payload }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setHiddenSettingKeys(
        new Set([
          NAV_MENU_IN_BURGER_KEY,
          SETTINGS_KEYS_ADMIN_ONLY_KEY,
          ...adminOnlyKeysDraft,
        ]),
      );
      setMessage({
        type: 'ok',
        text: 'Список ключей сохранён. Перезагрузите страницу, чтобы обновить список полей.',
      });
    } catch {
      setMessage({ type: 'err', text: 'Не удалось сохранить список ключей' });
    } finally {
      setAdminKeysSaving(false);
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
      setSavedRows([]);
      setDraftRows([]);
      setSensitiveConfigured({});
      setSensitiveDrafts({});
      setSensitiveModes({});
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

  function renderSettingField(key: string) {
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
    const sensitiveSaveUi = usesSensitiveSaveUi(key);
    const sensitiveMode = sensitiveModes[key] ?? 'keep';
    const configured = Boolean(sensitiveConfigured[key]);
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
        ) : key === 'OPENROUTER_API_KEY' ? (
          <div style={{ display: 'grid', gap: '0.45rem' }}>
            <p style={{ color: 'var(--muted)', fontSize: '0.82rem', lineHeight: 1.45, margin: 0 }}>
              {configured
                ? 'В базе уже есть значение; оно не показывается в форме.'
                : 'В базе пока нет значения для этого поля.'}{' '}
              Введите ключ только если нужно записать или заменить его.
            </p>
            <input
              type="password"
              value={valueForDraft(key)}
              name={key}
              autoComplete="new-password"
              placeholder={configured ? 'Новый ключ (пусто = не менять при сохранении)' : 'OpenRouter API key'}
              disabled={saving}
              onChange={(e) => setDraftKey(key, e.target.value)}
            />
          </div>
        ) : sensitiveSaveUi ? (
          <div style={{ display: 'grid', gap: '0.45rem' }}>
            <div style={{ color: 'var(--muted)', fontSize: '0.82rem', lineHeight: 1.45 }}>
              {configured
                ? 'В базе уже есть значение; оно не показывается в форме.'
                : 'В базе пока нет значения для этого поля.'}{' '}
              Выберите, что сделать при нажатии «Сохранить».
            </div>
            <select
              value={sensitiveMode}
              disabled={saving}
              aria-label={`${label}: действие при сохранении`}
              onChange={(e) => setSensitiveMode(key, e.target.value as SensitiveMode)}
            >
              <option value="keep">Не менять (оставить в базе как сейчас)</option>
              <option value="replace">Записать новый ключ / токен</option>
              <option value="clear">Удалить из базы (очистить)</option>
            </select>
            {sensitiveMode === 'replace' ? (
              <input
                type="password"
                value={sensitiveDrafts[key] ?? ''}
                name={key}
                autoComplete="new-password"
                placeholder={configured ? 'Новое значение' : 'Значение для записи в базу'}
                onChange={(e) => setSensitiveDraftKey(key, e.target.value)}
              />
            ) : null}
          </div>
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
        Значения хранятся в SQLite на сервере API. Чувствительные поля не читаются
        обратно в браузер: можно только увидеть, задан ли секрет, заменить его
        или очистить. Изменения применяются на сервере только после нажатия
        «Сохранить».
      </p>
      {message && (
        <p className={`msg ${message.type === 'ok' ? 'ok' : 'err'}`}>
          {message.text}
        </p>
      )}
      <div className="settingsAccordion" style={{ marginTop: '0.75rem' }}>
        {settingsSectionsVisible.map((section) => (
          <details key={section.id} className="card">
            <summary className="settingsSectionSummary">{section.title}</summary>
            <div className="settingsForm" style={{ marginTop: '0.9rem' }}>
              {section.keys.map((key) => renderSettingField(key))}
            </div>
          </details>
        ))}

        {!hiddenSettingKeys.has('SOURCE_LIST') || !hiddenSettingKeys.has('SOURCE_EXCLUDE_LIST') ? (
        <details className="card">
          <summary className="settingsSectionSummary">Источники и исключения</summary>
          <div style={{ marginTop: '0.9rem' }}>
            <p style={{ color: 'var(--muted)', marginBottom: '0.75rem', fontSize: '0.9rem' }}>
              Управляет списком `source`, который доступен для редактирования в сделках (`/trades`)
              и отдельным списком исключений для аналитики.
            </p>
            {!hiddenSettingKeys.has('SOURCE_LIST') ? (
              <>
                <div
                  style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}
                >
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
                  <div
                    style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.85rem' }}
                  >
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
              </>
            ) : null}

            {!hiddenSettingKeys.has('SOURCE_EXCLUDE_LIST') ? (
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
            ) : null}
          </div>
        </details>
        ) : null}

        {!hiddenSettingKeys.has(DIAGNOSTIC_MODELS_KEY) ? (
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

        {appIsAdmin ? (
          <>
            <details className="card">
              <summary className="settingsSectionSummary">Меню (администратор)</summary>
              <div style={{ marginTop: '0.9rem' }}>
                <p style={{ color: 'var(--muted)', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                  Отмеченные пункты открываются из бургера в шапке; снятая отметка — пункт в основной
                  полоске рядом с кабинетом и «Выйти».
                </p>
                <div style={{ display: 'grid', gap: '0.35rem' }}>
                  {NAV_ITEMS.map((item) => (
                    <label
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={navInBurgerDraft.has(item.id)}
                        onChange={() => {
                          setNavInBurgerDraft((prev) => {
                            const n = new Set(prev);
                            if (n.has(item.id)) n.delete(item.id);
                            else n.add(item.id);
                            return n;
                          });
                        }}
                      />
                      <span>{item.label}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: '0.85rem' }}
                  disabled={navMenuSaving}
                  onClick={() => void saveNavMenuConfig()}
                >
                  {navMenuSaving ? 'Сохранение…' : 'Сохранить меню'}
                </button>
              </div>
            </details>

            <details className="card">
              <summary className="settingsSectionSummary">
                Ключи настроек только для администратора
              </summary>
              <div style={{ marginTop: '0.9rem' }}>
                <p style={{ color: 'var(--muted)', fontSize: '0.88rem', marginBottom: '0.75rem' }}>
                  Выбранные ключи скрыты от обычных пользователей и недоступны им в API. Ключи{' '}
                  <code style={{ fontSize: '0.8rem' }}>{NAV_MENU_IN_BURGER_KEY}</code> и{' '}
                  <code style={{ fontSize: '0.8rem' }}>{SETTINGS_KEYS_ADMIN_ONLY_KEY}</code> всегда
                  только у администратора.
                </p>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: '0.35rem 0.75rem',
                    maxHeight: 'min(50vh, 420px)',
                    overflowY: 'auto',
                  }}
                >
                  {PUT_ORDER.map((key) => (
                    <label
                      key={key}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.45rem',
                        cursor: 'pointer',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={adminOnlyKeysDraft.has(key)}
                        onChange={() => {
                          setAdminOnlyKeysDraft((prev) => {
                            const n = new Set(prev);
                            if (n.has(key)) n.delete(key);
                            else n.add(key);
                            return n;
                          });
                        }}
                      />
                      <span style={{ fontSize: '0.82rem' }}>{labelForKey(key)}</span>
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  className="btn"
                  style={{ marginTop: '0.85rem' }}
                  disabled={adminKeysSaving}
                  onClick={() => void saveAdminOnlyKeysConfig()}
                >
                  {adminKeysSaving ? 'Сохранение…' : 'Сохранить список ключей'}
                </button>
              </div>
            </details>
          </>
        ) : null}

        {appIsAdmin ? (
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
