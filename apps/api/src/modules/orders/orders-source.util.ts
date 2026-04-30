export function parseStringList(raw: string | undefined): string[] {
  const text = String(raw ?? '').trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
  } catch {
    return text
      .split(/[\n,]/g)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
}
