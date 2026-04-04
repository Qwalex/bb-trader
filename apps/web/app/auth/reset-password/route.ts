import { NextResponse } from 'next/server';

import { withBasePath } from '../../../lib/auth';
import { createSupabaseRouteClient } from '../../../lib/supabase-route';

export async function POST(request: Request) {
  const form = await request.formData();
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';

  try {
    const routeClient = createSupabaseRouteClient(request);
    const { supabase } = routeClient;
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      throw error;
    }
    const response = NextResponse.redirect(
      new URL(`${withBasePath('/reset-password')}?status=updated`, request.url),
    );
    return routeClient.setRedirectResponse(response);
  } catch {
    return NextResponse.redirect(new URL(`${withBasePath('/reset-password')}?status=failed`, request.url));
  }
}
