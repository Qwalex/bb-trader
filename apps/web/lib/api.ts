/**
 * Публичный origin веб-приложения (`WEB_APP_ORIGIN`), совпадает с одним из API_CORS_ORIGINS на API.
 * Нужен для SSR: серверный fetch не шлёт браузерный Origin, без него ApiAuthGuard отвечает 403.
 */
function getWebAppOriginForSsr(): string | undefined {
  const raw = process.env.WEB_APP_ORIGIN?.trim();
  if (!raw) return undefined;
  try {
    return new URL(raw).origin.replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
}

export function getApiBase(): string {
  const isServer = typeof window === 'undefined';
  if (isServer) {
    return (
      process.env.API_INTERNAL_URL?.replace(/\/$/, '') ??
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
      'http://api:3001'
    );
  }
  return (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
    `${window.location.origin}/trade-api`
  );
}

function getClientCabinetId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const fromStorage = window.localStorage.getItem('active_cabinet_id')?.trim();
  if (fromStorage) return fromStorage;
  return undefined;
}

function getClientTokenFromCookie(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('sb_auth_token='))
    ?.slice('sb_auth_token='.length);
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function withCabinetQuery(path: string, cabinetId?: string | null): string {
  const id = String(cabinetId ?? '').trim();
  if (!id) return path;
  const [baseRaw, hash = ''] = path.split('#', 2);
  const base = baseRaw ?? path;
  const hasQuery = base.includes('?');
  const next = `${base}${hasQuery ? '&' : '?'}cabinetId=${encodeURIComponent(id)}`;
  return hash ? `${next}#${hash}` : next;
}

/** Заголовки для запросов к API (Bearer из env). */
export function getApiAuthHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init ?? undefined);
  const isServer = typeof window === 'undefined';
  if (isServer && !headers.has('Origin')) {
    const origin = getWebAppOriginForSsr();
    if (origin) {
      headers.set('Origin', origin);
    }
  }
  const token = isServer
    ? (process.env.API_ACCESS_TOKEN?.trim() ??
      process.env.NEXT_PUBLIC_API_ACCESS_TOKEN?.trim())
    : getClientTokenFromCookie() ??
      process.env.NEXT_PUBLIC_API_ACCESS_TOKEN?.trim();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

export async function fetchJson<T>(
  path: string,
  init?: RequestInit,
  cabinetId?: string | null,
): Promise<T> {
  const effectiveCabinetId = String(
    cabinetId ?? getClientCabinetId() ?? '',
  ).trim();
  const headers = new Headers(getApiAuthHeaders(init?.headers ?? undefined));
  if (typeof window === 'undefined' && !headers.has('Authorization')) {
    try {
      const { cookies } = await import('next/headers');
      const serverToken = (await cookies()).get('sb_auth')?.value?.trim();
      if (serverToken) {
        headers.set('Authorization', `Bearer ${serverToken}`);
      }
    } catch {
      // no-op outside Next server runtime
    }
  }
  if (effectiveCabinetId) {
    headers.set('x-cabinet-id', effectiveCabinetId);
  }
  const res = await fetch(`${getApiBase()}${withCabinetQuery(path, effectiveCabinetId)}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
