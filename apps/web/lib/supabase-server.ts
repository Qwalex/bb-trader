import 'server-only';

import { cookies } from 'next/headers';

import { createServerClient } from '@supabase/ssr';

import { getSupabaseAnonKey, getSupabaseUrl } from './supabase';

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  return createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll() {
        // Cookie writes are handled in middleware and route handlers.
      },
    },
  });
}
