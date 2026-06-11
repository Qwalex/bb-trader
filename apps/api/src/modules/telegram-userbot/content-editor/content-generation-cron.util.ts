/** Minimal 5-field cron matcher (minute hour dom month dow). Supports *, numbers, ranges, lists, step. */
export function cronFieldMatches(field: string, value: number, min: number, max: number): boolean {
  const f = field.trim();
  if (f === '*') return true;
  for (const part of f.split(',')) {
    const p = part.trim();
    if (!p) continue;
    const [baseRaw, stepRaw] = p.split('/');
    const base = baseRaw ?? '*';
    const step = stepRaw ? Math.max(1, Number.parseInt(stepRaw, 10) || 1) : 1;
    if (base === '*') {
      if ((value - min) % step === 0) return true;
      continue;
    }
    if (base.includes('-')) {
      const [aRaw, bRaw] = base.split('-');
      const a = Number.parseInt(aRaw ?? '', 10);
      const b = Number.parseInt(bRaw ?? '', 10);
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      for (let i = a; i <= b; i += step) {
        if (i === value) return true;
      }
      continue;
    }
    const n = Number.parseInt(base, 10);
    if (Number.isFinite(n) && n === value) return true;
  }
  return false;
}

/** Returns true if cron is null/empty (run every tick) or matches `date` (UTC). */
export function shouldRunCronNow(cron: string | null | undefined, date = new Date()): boolean {
  const raw = cron?.trim();
  if (!raw) return true;
  const parts = raw.split(/\s+/);
  if (parts.length < 5) return true;
  const [minF, hourF, domF, monthF, dowF] = parts;
  const minute = date.getUTCMinutes();
  const hour = date.getUTCHours();
  const dom = date.getUTCDate();
  const month = date.getUTCMonth() + 1;
  const dow = date.getUTCDay();
  return (
    cronFieldMatches(minF!, minute, 0, 59) &&
    cronFieldMatches(hourF!, hour, 0, 23) &&
    cronFieldMatches(domF!, dom, 1, 31) &&
    cronFieldMatches(monthF!, month, 1, 12) &&
    cronFieldMatches(dowF!, dow, 0, 6)
  );
}
