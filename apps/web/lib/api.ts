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

/** Заголовки для запросов к API (Bearer из env). */
export function getApiAuthHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init ?? undefined);
  const isServer = typeof window === 'undefined';
  const token = isServer
    ? (process.env.API_ACCESS_TOKEN?.trim() ??
      process.env.NEXT_PUBLIC_API_ACCESS_TOKEN?.trim())
    : process.env.NEXT_PUBLIC_API_ACCESS_TOKEN?.trim();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = getApiAuthHeaders(init?.headers ?? undefined);
  const res = await fetch(`${getApiBase()}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}
