import {
  CONTENT_COLLECT_KIND_VALUES,
  CONTENT_COLLECT_SETTING_KEY,
  DEFAULT_CONTENT_COLLECT_KINDS,
  parseContentCollectKinds,
  shouldCollectContentKind,
} from '@repo/shared';

import { SettingsService } from '../../settings/settings.service';

export { shouldCollectContentKind };

export async function readCollectKinds(settings: SettingsService): Promise<string[]> {
  const raw = await settings.get(CONTENT_COLLECT_SETTING_KEY);
  return parseContentCollectKinds(raw);
}

export async function saveCollectKinds(
  settings: SettingsService,
  kinds: string[],
): Promise<string[]> {
  const allowed = new Set<string>(CONTENT_COLLECT_KIND_VALUES);
  const normalized = kinds
    .map((k) => String(k).trim().toLowerCase())
    .filter((k) => allowed.has(k));
  const value = JSON.stringify(
    normalized.length > 0 ? normalized : [...DEFAULT_CONTENT_COLLECT_KINDS],
  );
  await settings.set(CONTENT_COLLECT_SETTING_KEY, value);
  return parseContentCollectKinds(value);
}

export function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => String(v).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export function stringifyJsonStringArray(values: string[]): string {
  return JSON.stringify(values.map((v) => String(v).trim()).filter(Boolean));
}
