import { NextResponse } from 'next/server';

import { csrfCheck } from '../../../lib/csrf-check';
import { withBasePath } from '../../../lib/auth';
import { getPublicOrigin } from '../../../lib/public-origin';
import { createSupabaseRouteClient } from '../../../lib/supabase-route';

export async function POST(request: Request) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;
  const form = await request.formData();
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
  const origin = getPublicOrigin(request);

  try {
    const routeClient = createSupabaseRouteClient(request);
    const { supabase } = routeClient;
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      throw error;
    }
    const response = NextResponse.redirect(
      new URL(`${withBasePath('/reset-password')}?status=updated`, origin),
    );
    return routeClient.setRedirectResponse(response);
  } catch {
    return NextResponse.redirect(new URL(`${withBasePath('/reset-password')}?status=failed`, origin));
  }
}
