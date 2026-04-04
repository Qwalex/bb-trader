import { NextResponse } from 'next/server';

import { withBasePath } from '../../../lib/auth';
import { createSupabaseAdminClient } from '../../../lib/supabase-admin';
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
  const form = await request.formData();
  const email = typeof form.get('email') === 'string' ? String(form.get('email')).trim() : '';
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
  const workspaceName =
    typeof form.get('workspaceName') === 'string' ? String(form.get('workspaceName')).trim() : '';

  if (!email || !password || !workspaceName) {
    return NextResponse.redirect(new URL(`${withBasePath('/signup')}?error=signup_failed`, request.url));
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? `${new URL(request.url).origin}${withBasePath('')}`;
  const signupRedirect = `${siteUrl}${withBasePath('/login')}`;

  const routeClient = createSupabaseRouteClient(request);
  const { supabase } = routeClient;
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: signupRedirect,
      data: {
        workspace_name: workspaceName,
        workspace_slug: slugifyWorkspaceName(workspaceName),
      },
    },
  });
  if (error || !data.user) {
    return NextResponse.redirect(new URL(`${withBasePath('/signup')}?error=signup_failed`, request.url));
  }

  const admin = createSupabaseAdminClient();
  await admin.auth.admin.updateUserById(data.user.id, {
    user_metadata: {
      workspace_name: workspaceName,
      workspace_slug: slugifyWorkspaceName(workspaceName),
    },
  });

  return NextResponse.redirect(
    new URL(`${withBasePath('/signup')}?error=confirmation_required`, request.url),
  );
}
