import { createBrowserClient } from '@supabase/ssr';

export function getSupabaseUrl(explicit?: string): string {
  const value = explicit?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required');
  }
  return value;
}

export function getSupabaseAnonKey(explicit?: string): string {
  const value = explicit?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!value) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is required');
  }
  return value;
}

export function createSupabaseBrowserClient(
  supabaseUrl?: string,
  supabaseAnonKey?: string,
) {
  return createBrowserClient(
    getSupabaseUrl(supabaseUrl),
    getSupabaseAnonKey(supabaseAnonKey),
  );
}
