import { createClient } from '@supabase/supabase-js';

import { getSupabaseServiceRoleKey, getSupabaseUrl } from './supabase';

export function createSupabaseAdminClient() {
  return createClient(getSupabaseUrl(), getSupabaseServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
