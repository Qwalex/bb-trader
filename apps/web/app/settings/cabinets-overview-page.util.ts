import { parseStoredEntry } from '../../lib/entry-sizing';
import {
  isTelegramNotifyApiTradeCancelledEnabled,
  tpSlStepStartSelectFromDraft,
} from './settings-page.util';
import type { Row } from './settings.types';

export function valueOf(rows: Row[], key: string): string {
  return rows.find((row) => row.key === key)?.value ?? '';
}

export function parseStringList(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean);
    }
  } catch {
    // ignore invalid JSON, fallback to csv/newline parsing
  }
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatStringList(raw: string): string {
  const values = parseStringList(raw);
  if (values.length === 0) return '—';
  return values.join(', ');
}

export function formatBoolean(raw: string): string {
  return raw.trim().toLowerCase() === 'true' ? 'Вкл' : 'Выкл';
}

export function formatTelegramNotifyTradeEvents(raw: string): string {
  const value = raw.trim().toLowerCase();
  if (value === '' || value === 'true' || value === '1' || value === 'yes') {
    return 'Вкл';
  }
  return 'Выкл';
}

export function formatTelegramNotifyApiTradeCancelled(raw: string): string {
  return isTelegramNotifyApiTradeCancelledEnabled(raw) ? 'Вкл' : 'Выкл';
}

export function formatTradeEventTypes(raw: string): string {
  const value = raw.trim();
  if (!value) return 'Все типы';
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return 'Все типы';
    if (parsed.length === 0) return 'Ни одного';
    const normalized = parsed.map((item) => String(item));
    const preview = normalized.slice(0, 3).join(', ');
    return normalized.length > 3 ? `${normalized.length} шт. (${preview}...)` : preview;
  } catch {
    return value;
  }
}

export function formatDefaultOrderUsd(raw: string): string {
  const parsed = parseStoredEntry(raw);
  if (!parsed.amount) return '—';
  return parsed.mode === 'percent' ? `${parsed.amount} %` : `${parsed.amount} USDT`;
}

export function formatTpSlStepStart(raw: string): string {
  const normalized = tpSlStepStartSelectFromDraft(raw, false).value;
  switch (normalized) {
    case 'off':
      return 'Выключено';
    case 'tp1':
      return 'С TP1';
    case 'tp2':
      return 'С TP2';
    case 'tp3':
      return 'С TP3';
    case 'tp4':
      return 'С TP4';
    case 'tp5':
      return 'С TP5';
    default:
      return normalized;
  }
}

export function formatCommonValue(raw: string): string {
  const value = raw.trim();
  return value ? value : '—';
}
