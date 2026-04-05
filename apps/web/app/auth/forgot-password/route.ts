import { NextResponse } from 'next/server';

import { withBasePath } from '../../../lib/auth';
import { getPublicOrigin, getPublicSiteBase } from '../../../lib/public-origin';
import { createSupabaseRouteClient } from '../../../lib/supabase-route';

export async function POST(request: Request) {
  const form = await request.formData();
  const email = typeof form.get('email') === 'string' ? String(form.get('email')).trim() : '';
  const siteBase = getPublicSiteBase(request);
  const redirectTo = new URL(withBasePath('/auth/confirm'), `${siteBase}/`);
  redirectTo.searchParams.set('next', withBasePath('/reset-password'));
  const origin = getPublicOrigin(request);

  try {
    const routeClient = createSupabaseRouteClient(request);
    const { supabase } = routeClient;
    await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectTo.toString() });
    return NextResponse.redirect(new URL(`${withBasePath('/forgot-password')}?status=sent`, origin));
  } catch {
    return NextResponse.redirect(new URL(`${withBasePath('/forgot-password')}?status=failed`, origin));
  }
}
