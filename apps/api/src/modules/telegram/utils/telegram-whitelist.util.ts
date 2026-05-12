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

/** Числовой chat_id для sendMessage; из поля AuthUser/CabinetMember.telegramUserId. */
export function parseStoredTelegramUserIdAsChatId(
  raw: string | null | undefined,
): number | null {
  const n = parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function mergeDistinctFiniteNumericIds(ids: number[]): number[] {
  const set = new Set<number>();
  for (const n of ids) {
    if (Number.isFinite(n)) set.add(n);
  }
  return Array.from(set).sort((a, b) => a - b);
}
