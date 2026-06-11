/** Kinds stored in content editor (non-trading ingest classifications). */
export type ContentCollectKind = 'analysis' | 'content' | 'news' | 'other';

export const CONTENT_COLLECT_KIND_VALUES = [
  'analysis',
  'content',
  'news',
  'other',
] as const satisfies readonly ContentCollectKind[];

export const CONTENT_COLLECT_SETTING_KEY = 'CONTENT_COLLECT_KINDS';

export const DEFAULT_CONTENT_COLLECT_KINDS: ContentCollectKind[] = [
  'analysis',
  'content',
  'news',
  'other',
];

/** Never collected regardless of cabinet settings. */
export const CONTENT_COLLECT_EXCLUDED_KINDS = new Set([
  'signal',
  'close',
  'reentry',
  'result',
  'ad',
  'promo',
  'ignore',
]);

export function parseContentCollectKinds(raw: string | null | undefined): ContentCollectKind[] {
  if (!raw?.trim()) return [...DEFAULT_CONTENT_COLLECT_KINDS];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [...DEFAULT_CONTENT_COLLECT_KINDS];
    const allowed = new Set<string>(CONTENT_COLLECT_KIND_VALUES);
    const out = parsed
      .map((v) => String(v).trim().toLowerCase())
      .filter((v): v is ContentCollectKind => allowed.has(v));
    return out.length > 0 ? out : [...DEFAULT_CONTENT_COLLECT_KINDS];
  } catch {
    return [...DEFAULT_CONTENT_COLLECT_KINDS];
  }
}

export function shouldCollectContentKind(
  kind: string,
  collectKinds: readonly string[],
): boolean {
  const k = String(kind ?? '').trim().toLowerCase();
  if (CONTENT_COLLECT_EXCLUDED_KINDS.has(k)) return false;
  return collectKinds.includes(k);
}
