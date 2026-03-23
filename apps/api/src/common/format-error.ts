/**
 * Превращает неизвестную ошибку в читаемую строку (логи, Telegram, API).
 * Избегает "[object Object]" для plain objects и axios/bybit-ответов.
 */
export function formatError(err: unknown, maxLen = 2000): string {
  if (err === undefined || err === null) {
    return 'unknown';
  }
  if (typeof err === 'string') {
    return truncate(err, maxLen);
  }
  if (err instanceof Error) {
    return truncate(err.message || err.name || 'Error', maxLen);
  }
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;

    if (typeof o.message === 'string' && o.message.length > 0) {
      return truncate(o.message, maxLen);
    }

    const retMsg = o.retMsg;
    const retCode = o.retCode;
    if (retMsg != null || retCode != null) {
      const parts = [
        retCode != null ? String(retCode) : '',
        retMsg != null ? String(retMsg) : '',
      ].filter(Boolean);
      if (parts.length) return truncate(parts.join(' '), maxLen);
    }

    const axiosResp = (o as { response?: { data?: unknown; status?: number } })
      .response;
    if (axiosResp?.data !== undefined) {
      const d = axiosResp.data;
      const text =
        typeof d === 'string'
          ? d
          : safeJson(d) ?? `HTTP ${axiosResp.status ?? '?'}`;
      return truncate(text, maxLen);
    }

    const nested = safeJson(err);
    if (nested) return truncate(nested, maxLen);
  }

  try {
    return truncate(String(err), maxLen);
  } catch {
    return 'unknown';
  }
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 20)}… (truncated)`;
}
