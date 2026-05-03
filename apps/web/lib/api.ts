import { getClientTokenFromCookie, getServerTokenFromCookies } from './api-auth.util';
import { normalizeBasePath } from './base-path';
import {
  ACTIVE_CABINET_STORAGE_KEY,
  DEFAULT_INTERNAL_API_BASE,
} from './api.constants';

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
      DEFAULT_INTERNAL_API_BASE
    );
  }
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  return `${window.location.origin}${basePath}/api/backend`;
}

function getClientCabinetId(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const fromStorage = window.localStorage.getItem(ACTIVE_CABINET_STORAGE_KEY)?.trim();
  if (fromStorage) return fromStorage;
  return undefined;
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
  // На сервере JWT из cookie подставляется в `enrichAuthHeaderForServer` (async).
  // Нельзя брать `API_ACCESS_TOKEN` здесь: иначе он перекрывает сессию пользователя и
  // ApiAuthGuard отвечает 401, если env-токен устарел или не совпадает с `AUTH_JWT_SECRET` на API.
  const token = isServer ? undefined : getClientTokenFromCookie();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

async function enrichAuthHeaderForServer(headers: Headers): Promise<void> {
  if (typeof window !== 'undefined') {
    return;
  }
  const serverToken = await getServerTokenFromCookies();
  if (serverToken) {
    headers.set('Authorization', `Bearer ${serverToken}`);
    return;
  }
  if (!headers.has('Authorization')) {
    const envToken = process.env.API_ACCESS_TOKEN?.trim();
    if (envToken) {
      headers.set('Authorization', `Bearer ${envToken}`);
    }
  }
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
  await enrichAuthHeaderForServer(headers);
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

export async function fetchApiResponse(
  path: string,
  init?: RequestInit,
  cabinetId?: string | null,
): Promise<Response> {
  const effectiveCabinetId = String(
    cabinetId ?? getClientCabinetId() ?? '',
  ).trim();
  const headers = new Headers(getApiAuthHeaders(init?.headers ?? undefined));
  await enrichAuthHeaderForServer(headers);
  if (effectiveCabinetId) {
    headers.set('x-cabinet-id', effectiveCabinetId);
  }
  return fetch(`${getApiBase()}${withCabinetQuery(path, effectiveCabinetId)}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
}
