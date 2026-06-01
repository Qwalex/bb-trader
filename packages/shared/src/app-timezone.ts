/** Календарные сутки и отображение времени по умолчанию (Railway/Docker = UTC). */
export const DEFAULT_APP_TIMEZONE = 'Europe/Moscow';

/** IANA timezone: `APP_TIMEZONE` / `NEXT_PUBLIC_DISPLAY_TIMEZONE` или Moscow. */
export function resolveAppTimeZone(explicit?: string | null): string {
  const fromArg = String(explicit ?? '').trim();
  if (fromArg) {
    return fromArg;
  }
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv =
      process.env.APP_TIMEZONE?.trim() ||
      process.env.NEXT_PUBLIC_APP_TIMEZONE?.trim() ||
      process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE?.trim();
    if (fromEnv) {
      return fromEnv;
    }
  }
  return DEFAULT_APP_TIMEZONE;
}

/** Начало календарных суток в `timeZone` для момента `instant` (UTC `Date`). */
export function startOfCalendarDayInTimeZone(
  instant: Date,
  timeZone: string = resolveAppTimeZone(),
): Date {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(instant);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const second = Number(parts.find((p) => p.type === 'second')?.value ?? 0);
  const ms =
    ((hour * 60 + minute) * 60 + second) * 1000 + instant.getMilliseconds();
  return new Date(instant.getTime() - ms);
}

export function startOfAppCalendarDay(
  instant: Date = new Date(),
  timeZone: string = resolveAppTimeZone(),
): Date {
  return startOfCalendarDayInTimeZone(instant, timeZone);
}

/** `YYYY-MM-DD` в календаре `timeZone`. */
export function calendarDayKeyInTimeZone(
  instant: Date,
  timeZone: string = resolveAppTimeZone(),
): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** +N календарных дней от начала суток `dayStart` в `timeZone`. */
export function addCalendarDaysInTimeZone(
  dayStart: Date,
  deltaDays: number,
  timeZone: string = resolveAppTimeZone(),
): Date {
  const key = calendarDayKeyInTimeZone(dayStart, timeZone);
  const parts = key.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const probe = new Date(Date.UTC(y, m - 1, d + deltaDays, 12, 0, 0, 0));
  return startOfCalendarDayInTimeZone(probe, timeZone);
}

export function endOfCalendarDayInTimeZone(
  instant: Date,
  timeZone: string = resolveAppTimeZone(),
): Date {
  const nextStart = addCalendarDaysInTimeZone(
    startOfCalendarDayInTimeZone(instant, timeZone),
    1,
    timeZone,
  );
  return new Date(nextStart.getTime() - 1);
}

/** Границы текущих суток в app timezone (для снимков баланса). */
export function appCalendarDayRange(
  instant: Date = new Date(),
  timeZone: string = resolveAppTimeZone(),
): { start: Date; end: Date } {
  const start = startOfCalendarDayInTimeZone(instant, timeZone);
  const end = addCalendarDaysInTimeZone(start, 1, timeZone);
  return { start, end };
}

export function appTimeZoneShortLabel(timeZone: string = resolveAppTimeZone()): string {
  if (timeZone === 'Europe/Moscow') {
    return 'МСК';
  }
  return timeZone;
}
