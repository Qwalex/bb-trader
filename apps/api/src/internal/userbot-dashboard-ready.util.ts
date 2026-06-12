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
 * Live MTProto или завершённая настройка сессии (QR / сохранённая строка).
 */
export function isUserbotDashboardReady(params: {
  state: UserbotGlobalConnectionState;
  userId: string;
}): boolean {
  const uid = String(params.userId ?? '').trim();
  if (!uid) {
    return false;
  }
  const state = params.state;
  if (state.connected) {
    return true;
  }
  if (!state.sessionConfigured || !state.enabled) {
    return false;
  }
  const ownerId = String(state.sessionOwnerUserId ?? '').trim();
  if (ownerId) {
    return ownerId === uid;
  }
  // Legacy: сессия есть, владелец не записан (один AuthUser / старые деплои).
  return true;
}
