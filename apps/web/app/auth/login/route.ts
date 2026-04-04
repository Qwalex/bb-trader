import { NextResponse } from 'next/server';

import { createSupabaseRouteClient } from '../../../lib/supabase-route';
import { withBasePath } from '../../../lib/auth';
import { normalizeRedirectTarget } from '../../../lib/redirect';

export async function POST(request: Request) {
  const form = await request.formData();
  const email = typeof form.get('email') === 'string' ? String(form.get('email')).trim() : '';
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
  const redirectTo = normalizeRedirectTarget(form.get('redirectTo'), withBasePath('/'));

  try {
    const routeClient = createSupabaseRouteClient(request);
    const { supabase } = routeClient;
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      return NextResponse.redirect(
        new URL(
          `${withBasePath('/login')}?error=auth_failed&redirectTo=${encodeURIComponent(
            redirectTo,
          )}`,
          request.url,
        ),
      );
    }
    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    return routeClient.setRedirectResponse(response);
  } catch {
    return NextResponse.redirect(
      new URL(
        `${withBasePath('/login')}?error=missing_auth_config&redirectTo=${encodeURIComponent(
          redirectTo,
        )}`,
        request.url,
      ),
    );
  }
}
