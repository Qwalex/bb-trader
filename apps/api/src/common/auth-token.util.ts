import {
  AUTH_COOKIE_KEYS,
} from './auth-cookies.constants';

export { AUTH_SESSION_COOKIE, AUTH_TOKEN_COOKIE } from './auth-cookies.constants';

export function extractBearerToken(value?: string): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function readCookieValue(cookieHeader: string, cookieKey: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.split('=');
    if (String(k ?? '').trim() !== cookieKey) {
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

/** JWT из cookie sb_auth (prod) или sb_auth_token (dev). */
export function extractTokenFromCookieHeader(value?: string | string[]): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const text = String(raw ?? '').trim();
  if (!text) {
    return null;
  }
  for (const key of AUTH_COOKIE_KEYS) {
    const token = readCookieValue(text, key);
    if (token) {
      return token;
    }
  }
  return null;
}
