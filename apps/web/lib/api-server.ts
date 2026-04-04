import 'server-only';

import { getApiBase } from './api';
import { createSupabaseServerClient } from './supabase-server';

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
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
