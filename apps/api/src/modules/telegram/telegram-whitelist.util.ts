/** Парсинг значения TELEGRAM_WHITELIST (строка из настроек кабинета). */
export function parseTelegramWhitelistUserIds(raw: string): number[] {
  const t = String(raw ?? '').trim();
  if (!t) {
    return [];
  }
  return t
    .split(/[,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}
