import { NextResponse } from 'next/server';

import { withBasePath } from '../../../lib/auth';
import { createSupabaseRouteClient } from '../../../lib/supabase-route';

export async function POST(request: Request) {
  const form = await request.formData();
  const email = typeof form.get('email') === 'string' ? String(form.get('email')).trim() : '';
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() ?? `${new URL(request.url).origin}${withBasePath('')}`;
  const redirectTo = `${siteUrl}${withBasePath('/reset-password')}`;

  try {
    const routeClient = createSupabaseRouteClient(request);
    const { supabase } = routeClient;
    await supabase.auth.resetPasswordForEmail(email, { redirectTo });
    return NextResponse.redirect(new URL(`${withBasePath('/forgot-password')}?status=sent`, request.url));
  } catch {
    return NextResponse.redirect(new URL(`${withBasePath('/forgot-password')}?status=failed`, request.url));
  }
}
