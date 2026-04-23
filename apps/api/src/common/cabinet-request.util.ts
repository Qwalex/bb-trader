export function pickRequestedCabinetId(params: {
  queryCabinetId?: string | null;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
}): string | undefined {
  const fromQuery = String(params.queryCabinetId ?? '').trim();
  if (fromQuery) {
    return fromQuery;
  }
  const raw = params.headers?.['x-cabinet-id'];
  const header = Array.isArray(raw) ? raw[0] : raw;
  const fromHeader = String(header ?? '').trim();
  if (fromHeader) {
    return fromHeader;
  }
  const fromCookie = String(params.cookies?.cabinet_id ?? '').trim();
  return fromCookie || undefined;
}

