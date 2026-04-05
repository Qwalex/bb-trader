import { NextResponse } from 'next/server';

import { withBasePath } from '../../../lib/auth';
import { getPublicOrigin, getPublicSiteBase } from '../../../lib/public-origin';
import { createSupabaseRouteClient } from '../../../lib/supabase-route';

export async function POST(request: Request) {
  const form = await request.formData();
  const email = typeof form.get('email') === 'string' ? String(form.get('email')).trim() : '';

  const origin = getPublicOrigin(request);
  const redirectSignup = (q: string) =>
    NextResponse.redirect(new URL(`${withBasePath('/signup')}?${q}`, origin));

  if (!email) {
    return redirectSignup('resend=missing_email');
  }

  const siteBase = getPublicSiteBase(request);
  const signupRedirect = new URL(withBasePath('/auth/confirm'), `${siteBase}/`);
  signupRedirect.searchParams.set('next', withBasePath('/login'));

  const routeClient = createSupabaseRouteClient(request);
  const { error } = await routeClient.supabase.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: signupRedirect.toString() },
  });

  const tail = `email=${encodeURIComponent(email)}`;
  if (error) {
    return routeClient.setRedirectResponse(
      redirectSignup(`resend=failed&${tail}`),
    );
  }
  return routeClient.setRedirectResponse(redirectSignup(`resend=ok&${tail}`));
}
