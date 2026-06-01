import { appTimeZoneShortLabel, resolveAppTimeZone } from '@repo/shared';

/** IANA timezone для отображения в UI (см. `APP_TIMEZONE` / `NEXT_PUBLIC_DISPLAY_TIMEZONE`). */
export function displayTimeZone(): string {
  return resolveAppTimeZone(process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE);
}

export function displayTimeZoneLabel(): string {
  return appTimeZoneShortLabel(displayTimeZone());
}

export function formatDateTimeRu(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: displayTimeZone(),
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}

export function formatTimeRu(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: displayTimeZone(),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(d);
}
