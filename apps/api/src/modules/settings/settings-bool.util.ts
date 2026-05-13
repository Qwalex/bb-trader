/**
 * Разбор булевых настроек из строки (UI, БД, env): согласовано с переключателями web (`true`/`false`)
 * и типичными env-значениями (`1`, `yes`, `on`).
 */
export function parseSettingsBool(
  raw: string | undefined | null,
  fallback: boolean,
): boolean {
  if (raw == null) {
    return fallback;
  }
  const s = String(raw).trim().toLowerCase();
  if (s === '') {
    return fallback;
  }
  if (
    s === 'true' ||
    s === '1' ||
    s === 'yes' ||
    s === 'on' ||
    s === 'enabled'
  ) {
    return true;
  }
  if (
    s === 'false' ||
    s === '0' ||
    s === 'no' ||
    s === 'off' ||
    s === 'disabled'
  ) {
    return false;
  }
  return fallback;
}
