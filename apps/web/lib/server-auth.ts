import { createSupabaseServerClient } from './supabase-server';

export async function readDashboardSession() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
