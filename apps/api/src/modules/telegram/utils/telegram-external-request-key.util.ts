export function makeExternalRequestKey(cabinetId: string, ingestId: string): string {
  return `${cabinetId}|${ingestId}`;
}

export function parseExternalRequestKey(raw: string): { cabinetId: string; ingestId: string } {
  const text = String(raw ?? '').trim();
  const idx = text.indexOf('|');
  if (idx <= 0) {
    return { cabinetId: '', ingestId: text };
  }
  return {
    cabinetId: text.slice(0, idx).trim(),
    ingestId: text.slice(idx + 1).trim(),
  };
}
