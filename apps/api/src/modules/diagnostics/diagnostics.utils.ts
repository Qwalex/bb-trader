import type { DiagnosticStatus } from './diagnostics.types';

export function parseStringList(raw: string | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
  } catch {
    return text
      .split(/[\n,]/g)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
}

export function toFiniteInt(raw: string | number | undefined, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

export function toJsonString(payload: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      if (value && typeof value === 'object') {
        if (seen.has(value as object)) {
          return '[Circular]';
        }
        seen.add(value as object);
      }
      return value;
    });
  } catch {
    return JSON.stringify({
      __diagnosticsSerializationError: true,
      message: 'Failed to serialize diagnostics payload',
    });
  }
}

export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function normalizeStatus(raw: unknown): DiagnosticStatus {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'ok' || v === 'warning' || v === 'error' || v === 'unknown') {
    return v;
  }
  return 'unknown';
}

export function arrStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0);
}
