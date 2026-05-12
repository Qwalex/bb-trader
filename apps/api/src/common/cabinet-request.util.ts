/** Nest/Express: `cabinetId` в query может быть `string[]` при дублях; `String([])` даёт невалидный id. */
function scalarCabinetToken(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const s = scalarCabinetToken(x);
      if (s) return s;
    }
    return undefined;
  }
  const s = String(raw).trim();
  return s || undefined;
}

export function pickRequestedCabinetId(params: {
  queryCabinetId?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}): string | undefined {
  const fromQuery = scalarCabinetToken(params.queryCabinetId);
  if (fromQuery) {
    return fromQuery;
  }
  const raw = params.headers?.['x-cabinet-id'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const fromHeader = scalarCabinetToken(header);
  if (fromHeader) {
    return fromHeader;
  }
  return scalarCabinetToken(params.cookies?.cabinet_id);
}

