import { NextResponse } from 'next/server';

import { createSupabaseRouteClient } from '../../../lib/supabase-route';
import { withBasePath } from '../../../lib/auth';
import { getPublicOrigin } from '../../../lib/public-origin';

export async function POST(request: Request) {
  const routeClient = createSupabaseRouteClient(request);
  const { supabase } = routeClient;
  await supabase.auth.signOut();
  const response = NextResponse.redirect(new URL(withBasePath('/login'), getPublicOrigin(request)));
  return routeClient.setRedirectResponse(response);
}
