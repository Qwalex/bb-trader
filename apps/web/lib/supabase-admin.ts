import { createClient } from '@supabase/supabase-js';

import { getSupabaseUrl } from './supabase';

function getSupabaseServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY_SERVER?.trim();
  if (!value) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY_SERVER is required');
  }
  return value;
}

export function createSupabaseAdminClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
