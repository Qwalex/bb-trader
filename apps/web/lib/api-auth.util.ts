import { AUTH_COOKIE, AUTH_TOKEN_COOKIE } from './api.constants';

export function readCookieValue(cookieHeader: string, cookieKey: string): string | undefined {
  const raw = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieKey}=`))
    ?.slice(`${cookieKey}=`.length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function getClientTokenFromCookie(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  return readCookieValue(document.cookie, AUTH_TOKEN_COOKIE);
}

export async function getServerTokenFromCookies(): Promise<string | undefined> {
  if (typeof window !== 'undefined') return undefined;
  try {
    const { cookies } = await import('next/headers');
    return (await cookies()).get(AUTH_COOKIE)?.value?.trim();
  } catch {
    return undefined;
  }
}
