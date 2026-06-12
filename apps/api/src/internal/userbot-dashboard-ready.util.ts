import type { UserbotGlobalConnectionState } from './internal-userbot.types';

/** Парсит bool-настройку (`true` / иное / пусто). */
export function parseSettingsBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  return raw.trim().toLowerCase() === 'true';
}

/**
 * Достаточно ли глобального userbot для снятия предупреждения на дашборде.
 * Совпадает с ожиданием UI: live MTProto или сохранённая сессия (QR / строка в Setting).
 */
export function isUserbotDashboardReady(state: UserbotGlobalConnectionState): boolean {
  if (state.connected) {
    return true;
  }
  if (!state.sessionConfigured) {
    return false;
  }
  // Явно выключен в настройках — предупреждение остаётся.
  return state.enabled !== false;
}

/** Собирает глобальный снимок userbot из map key→value (Prisma Setting + env). */
export function buildUserbotGlobalConnectionState(params: {
  session?: string | null;
  enabledRaw?: string | null;
  sessionOwnerUserId?: string | null;
  connected?: boolean;
}): UserbotGlobalConnectionState {
  const sessionConfigured = Boolean(String(params.session ?? '').trim());
  return {
    connected: Boolean(params.connected),
    sessionConfigured,
    enabled: parseSettingsBool(
      params.enabledRaw ?? undefined,
      sessionConfigured,
    ),
    sessionOwnerUserId: String(params.sessionOwnerUserId ?? '').trim() || null,
  };
}
