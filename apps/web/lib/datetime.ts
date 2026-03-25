/**
 * Отображение дат в UI. На сервере Node без явного `timeZone` часто используется UTC
 * (из‑за этого время «отстаёт» на 3 ч относительно МСК).
 * Переопределение: NEXT_PUBLIC_DISPLAY_TIMEZONE (IANA), например Europe/Kaliningrad.
 */
function displayTimeZone(): string {
  return process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE ?? 'Europe/Moscow';
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
