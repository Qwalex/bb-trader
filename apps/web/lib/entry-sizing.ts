/**
 * Формат хранения в БД совпадает с API: "10" (USDT) или "10%" (доля от суммарного баланса).
 */

export type EntrySizingMode = 'usdt' | 'percent';

export function parseStoredEntry(raw: string | null | undefined): {
  mode: EntrySizingMode;
  amount: string;
} {
  const s = raw != null ? String(raw).trim() : '';
  if (!s) return { mode: 'usdt', amount: '' };
  const hasPercent = /%\s*$/.test(s) || s.includes('%');
  const n = parseFloat(s.replace(/%/g, '').replace(',', '.').trim());
  if (!Number.isFinite(n) || n <= 0) return { mode: 'usdt', amount: '' };
  return { mode: hasPercent ? 'percent' : 'usdt', amount: String(n) };
}

export function serializeEntry(mode: EntrySizingMode, amount: string): string {
  const t = amount.trim().replace(',', '.');
  if (t === '') return '';
  const n = parseFloat(t);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (mode === 'percent') {
    return `${Math.min(n, 100)}%`;
  }
  return String(n);
}
