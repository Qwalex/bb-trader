const AUTH_TOKEN_COOKIE_KEY = 'sb_auth_token';

export function extractBearerToken(value?: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function extractTokenFromCookieHeader(value?: string | string[]): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }
  for (const part of text.split(';')) {
    const [k, ...rest] = part.split('=');
    if (String(k ?? '').trim() !== AUTH_TOKEN_COOKIE_KEY) {
      continue;
    }
    const v = rest.join('=').trim();
    if (!v) {
      return null;
    }
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}
