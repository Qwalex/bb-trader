import {
  DASHBOARD_SESSION_COOKIE,
  DEFAULT_DASHBOARD_SESSION_TTL_SECONDS,
  verifyDashboardSessionToken,
} from '@repo/shared';

export { DASHBOARD_SESSION_COOKIE, DEFAULT_DASHBOARD_SESSION_TTL_SECONDS };

export function normalizeBasePath(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!t || t === '/') return '';
  return (t.startsWith('/') ? t : `/${t}`).replace(/\/+$/, '');
}

export function withBasePath(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }
  return `${normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH)}${path}`;
}

export function getDashboardSessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret) {
    throw new Error('AUTH_SESSION_SECRET is required');
  }
  return secret;
}

export function getDashboardUsername(): string {
  const username = process.env.DASHBOARD_USERNAME?.trim();
  if (!username) {
    throw new Error('DASHBOARD_USERNAME is required');
  }
  return username;
}

export function getDashboardPassword(): string {
  const password = process.env.DASHBOARD_PASSWORD ?? '';
  if (!password) {
    throw new Error('DASHBOARD_PASSWORD is required');
  }
  return password;
}

export function getInternalApiAuthToken(): string {
  const token = process.env.API_INTERNAL_AUTH_TOKEN?.trim();
  if (token) {
    return token;
  }
  return getDashboardSessionSecret();
}

export function getDashboardCookieOptions() {
  return {
    name: DASHBOARD_SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DEFAULT_DASHBOARD_SESSION_TTL_SECONDS,
  };
}

export async function readDashboardSessionFromToken(token: string | null | undefined) {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!secret) {
    return null;
  }
  return verifyDashboardSessionToken(secret, token);
}
