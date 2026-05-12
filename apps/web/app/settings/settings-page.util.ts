import type { PendingChange, Row } from './settings.types';
import { normalizeBasePath } from '../../lib/base-path';
import {
  DIAGNOSTIC_MODELS_KEY,
  EXTRA_LABELS,
  KEYS,
  LABEL_BY_KEY,
  MODEL_HISTORY_KEY,
  MODEL_KEYS,
  PUT_ORDER,
} from './settings-page.constants';

export function withAppBasePath(url: string): string {
  if (!url.startsWith('/')) return url;
  const appBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  return `${appBasePath}${url}`;
}

export function labelForKey(key: string): string {
  return LABEL_BY_KEY[key] ?? EXTRA_LABELS[key] ?? key;
}

/**
 * Совпадает с API (`TelegramService.notifyApiTradeCancelled`): уведомления идут,
 * пока значение явно не выключено (opt-out).
 */
export function isTelegramNotifyApiTradeCancelledEnabled(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return !(v === 'false' || v === '0' || v === 'no' || v === 'off');
}

/** Соответствие черновика TP_SL_STEP_START варианту селекта + флаг мусора в поле. */
export function tpSlStepStartSelectFromDraft(
  draftRaw: string,
  legacyTpSlStepEnabledTrue: boolean,
): { value: string; invalidDraft: boolean } {
  const raw = draftRaw.trim().toLowerCase();
  const canonical = new Set(['off', 'tp1', 'tp2', 'tp3', 'tp4', 'tp5']);
  if (raw === '' && legacyTpSlStepEnabledTrue) {
    return { value: 'tp2', invalidDraft: false };
  }
  if (raw === '') {
    return { value: 'off', invalidDraft: false };
  }
  if (canonical.has(raw)) {
    return { value: raw, invalidDraft: false };
  }
  if (raw === 'true' || raw === '1') {
    return { value: 'tp2', invalidDraft: false };
  }
  if (raw === 'false' || raw === '0') {
    return { value: 'off', invalidDraft: false };
  }
  return { value: 'off', invalidDraft: true };
}

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

export function valueFor(rows: Row[], key: string): string {
  return rows.find((r) => r.key === key)?.value ?? '';
}

export function upsertRow(list: Row[], key: string, value: string): Row[] {
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
export function computeNextModelHistoryString(saved: Row[], draft: Row[]): string {
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

export function collectPendingChanges(saved: Row[], draft: Row[]): PendingChange[] {
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

export function buildPutOperations(saved: Row[], draft: Row[]): { key: string; value: string }[] {
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
