export type SourceMartingaleMap = Record<string, number>;

export function parseSourceMartingaleMap(raw: string | undefined): SourceMartingaleMap {
  const text = String(raw ?? '').trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: SourceMartingaleMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k ?? '').trim().toLowerCase();
      const n = Number(v);
      if (!key || !Number.isFinite(n) || n <= 1) {
        continue;
      }
      result[key] = n;
    }
    return result;
  } catch {
    return {};
  }
}
