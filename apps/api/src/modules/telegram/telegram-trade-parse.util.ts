export function parseNumberArrayFromJson(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

export function parseTakeProfitsForDisplay(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((x) => String(x)).join(', ') : raw;
  } catch {
    return raw;
  }
}
