import { NextResponse } from 'next/server';

import { csrfCheck } from '../../../lib/csrf-check';
import { withBasePath } from '../../../lib/auth';
import { getPublicOrigin, getPublicSiteBase } from '../../../lib/public-origin';
import { createSupabaseRouteClient } from '../../../lib/supabase-route';

function slugifyWorkspaceName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

export async function POST(request: Request) {
  const blocked = csrfCheck(request);
  if (blocked) return blocked;
  const form = await request.formData();
  const email = typeof form.get('email') === 'string' ? String(form.get('email')).trim() : '';
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
  const workspaceName =
    typeof form.get('workspaceName') === 'string' ? String(form.get('workspaceName')).trim() : '';

  const origin = getPublicOrigin(request);
  const fail = (q: string) => NextResponse.redirect(new URL(`${withBasePath('/signup')}?${q}`, origin));

  if (!email || !password || !workspaceName) {
    return fail('error=signup_failed');
  }

  const siteBase = getPublicSiteBase(request);
  const signupRedirect = new URL(withBasePath('/auth/confirm'), `${siteBase}/`);
  signupRedirect.searchParams.set('next', withBasePath('/login'));

  const routeClient = createSupabaseRouteClient(request);
  const { supabase } = routeClient;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: signupRedirect.toString(),
      data: {
        workspace_name: workspaceName,
        workspace_slug: slugifyWorkspaceName(workspaceName),
      },
    },
  });
  if (error || !data.user) {
    return routeClient.setRedirectResponse(fail('error=signup_failed'));
  }

  // user_metadata задаётся через options.data; admin.updateUserById убран — при сбое service role
  // был ложный signup_failed после успешной отправки письма.
  const ok = NextResponse.redirect(
    new URL(
      `${withBasePath('/signup')}?error=confirmation_required&email=${encodeURIComponent(email)}`,
      origin,
    ),
  );
  return routeClient.setRedirectResponse(ok);
}
