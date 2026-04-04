import { cookies } from 'next/headers';

import {
  DASHBOARD_SESSION_COOKIE,
  INTERNAL_API_AUTH_HEADER,
} from '@repo/shared';

import { getInternalApiAuthToken, normalizeBasePath } from './auth';

export function getApiBase(): string {
  const isServer = typeof window === 'undefined';
  if (isServer) {
    return (
      process.env.API_INTERNAL_URL?.replace(/\/$/, '') ??
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
      'http://api:3001'
    );
  }
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (configured) {
    return configured;
  }
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  return (
    `${window.location.origin}${basePath ? `${basePath}-api` : '/api'}`
  );
}

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const isServer = typeof window === 'undefined';
  const headers = new Headers(init?.headers);
  if (isServer) {
    headers.set(INTERNAL_API_AUTH_HEADER, getInternalApiAuthToken());
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get(DASHBOARD_SESSION_COOKIE)?.value;
    if (sessionCookie) {
      headers.set('Cookie', `${DASHBOARD_SESSION_COOKIE}=${sessionCookie}`);
    }
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
