/**
 * Сигналы вида «entry range 1 - 2» приводим к одному входу — среднему (1.5),
 * чтобы LLM и пост-обработка не трактовали границы как два DCA-уровня.
 */

const ENTRY_RANGE_PATTERNS: RegExp[] = [
  /\b(?:entry\s+range|range\s+entry)\s*:?\s*([0-9]+[.,]?[0-9]*)\s*[-–—]\s*([0-9]+[.,]?[0-9]*)\b/gi,
  /\bдиапазон\s+входа\s*:?\s*([0-9]+[.,]?[0-9]*)\s*[-–—]\s*([0-9]+[.,]?[0-9]*)\b/gi,
];

function parseNum(s: string): number {
  return parseFloat(s.replace(',', '.'));
}

function formatEntryAvg(n: number): string {
  if (Number.isInteger(n)) {
    return String(n);
  }
  const t = n.toFixed(8).replace(/\.?0+$/, '');
  return t.length > 0 ? t : String(n);
}

/**
 * Подмена в тексте перед отправкой в LLM: «entry range A - B» → «entry (A+B)/2».
 */
export function normalizeEntryRangeInMessageText(text: string): string {
  let out = text;
  for (const re of ENTRY_RANGE_PATTERNS) {
    out = out.replace(re, (_m, a: string, b: string) => {
      const lo = parseNum(a);
      const hi = parseNum(b);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        return _m;
      }
      const avg = (lo + hi) / 2;
      return `entry ${formatEntryAvg(avg)}`;
    });
  }
  return out;
}

function firstRangeBounds(text: string): { lo: number; hi: number } | null {
  for (const re of ENTRY_RANGE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    const a = parseNum(m[1]!);
    const b = parseNum(m[2]!);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    return { lo: Math.min(a, b), hi: Math.max(a, b) };
  }
  return null;
}

/**
 * Если в тексте был диапазон входа, а модель вернула ровно два числа на границах диапазона —
 * заменяем на одно среднее (защита, если препроцессинг LLM проигнорировала).
 */
export function collapseEntriesIfEntryRangeText(
  originalText: string,
  entries: number[],
): number[] {
  if (entries.length !== 2) {
    return entries;
  }
  const bounds = firstRangeBounds(originalText);
  if (!bounds) {
    return entries;
  }
  const { lo, hi } = bounds;
  const e0 = entries[0];
  const e1 = entries[1];
  if (e0 === undefined || e1 === undefined) {
    return entries;
  }
  const span = hi - lo;
  const tol = Math.max(1e-8, span * 0.002);
  const matchesOrdered =
    Math.abs(e0 - lo) <= tol && Math.abs(e1 - hi) <= tol;
  const matchesSwapped =
    Math.abs(e0 - hi) <= tol && Math.abs(e1 - lo) <= tol;
  if (!matchesOrdered && !matchesSwapped) {
    return entries;
  }
  return [(lo + hi) / 2];
}
