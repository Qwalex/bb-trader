import 'server-only';

import { cookies } from 'next/headers';

import { getApiBase } from './api';
import { ACTIVE_WORKSPACE_COOKIE_KEY } from './active-workspace';
import { createSupabaseServerClient } from './supabase-server';

export async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('X-Workspace-Id')) {
    const store = await cookies();
    const ws = store.get(ACTIVE_WORKSPACE_COOKIE_KEY)?.value?.trim();
    if (ws) {
      headers.set('X-Workspace-Id', ws);
    }
  }
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
