import { normalizeBasePath } from './auth';
import { createSupabaseServerClient } from './supabase-server';

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
    const supabase = await createSupabaseServerClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers.set('Authorization', `Bearer ${session.access_token}`);
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
