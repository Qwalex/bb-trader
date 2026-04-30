export function parseNumberArrayFromJson(raw: string | null | undefined): number[] {
  if (!raw || typeof raw !== 'string') {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  } catch {
    return [];
  }
}

export function parseSourceMultiplierMap(raw: string | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const text = String(raw ?? '').trim();
  if (!text) {
    return out;
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return out;
    }
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const key = String(k ?? '').trim().toLowerCase();
      const val = Number(v);
      if (!key || !Number.isFinite(val) || val <= 1) {
        continue;
      }
      out.set(key, val);
    }
    return out;
  } catch {
    return out;
  }
}
