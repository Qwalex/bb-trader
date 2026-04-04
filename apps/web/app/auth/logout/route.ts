import { NextResponse } from 'next/server';

import { createSupabaseRouteClient } from '../../../lib/supabase-route';
import { withBasePath } from '../../../lib/auth';

export async function POST(request: Request) {
  const routeClient = createSupabaseRouteClient(request);
  const { supabase } = routeClient;
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL(withBasePath('/login'), request.url));
  return routeClient.setRedirectResponse(response);
}
