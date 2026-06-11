import { NAV_MENU_HIDDEN_SETTING_KEY } from '@repo/shared';

export { NAV_MENU_HIDDEN_SETTING_KEY };

/** null — настройка не задана (клиент подставит defaultHidden). */
export function parseNavHiddenMenuIds(raw: string | undefined | null): string[] | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed
      .map((v) => String(v).trim())
      .filter((v) => v.length > 0);
  } catch {
    return null;
  }
}
