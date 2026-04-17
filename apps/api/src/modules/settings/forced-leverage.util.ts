/** Глобальное FORCED_LEVERAGE из настроек / env. */
export function resolveGlobalForcedLeverage(rawGlobal: string | undefined): number | undefined {
  const gRaw = String(rawGlobal ?? '').trim().replace(',', '.');
  if (!gRaw) {
    return undefined;
  }
  const g = Number(gRaw);
  if (!Number.isFinite(g) || g < 1) {
    return undefined;
  }
  return Math.round(g);
}

/**
 * Принудительное плечо: карточка userbot (чат), иначе глобальное FORCED_LEVERAGE.
 */
export function resolveForcedLeverageWithChatOverride(
  chatForced: number | null | undefined,
  rawGlobal: string | undefined,
): number | undefined {
  if (chatForced != null && Number.isFinite(chatForced) && chatForced >= 1) {
    return Math.round(chatForced);
  }
  return resolveGlobalForcedLeverage(rawGlobal);
}
