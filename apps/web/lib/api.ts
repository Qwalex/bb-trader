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

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.NEXT_PUBLIC_API_ACCESS_TOKEN?.trim();
  const headers = new Headers(init?.headers ?? {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
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
