import { type EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { withBasePath } from '../../../lib/auth';
import { normalizeRedirectTarget } from '../../../lib/redirect';
import { createSupabaseRouteClient } from '../../../lib/supabase-route';

function failureRedirect(request: NextRequest, nextPath: string): NextResponse {
  if (nextPath === withBasePath('/reset-password')) {
    return NextResponse.redirect(
      new URL(`${withBasePath('/reset-password')}?status=failed`, request.url),
    );
  }

  return NextResponse.redirect(
    new URL(`${withBasePath('/login')}?error=auth_callback_failed`, request.url),
  );
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const nextPath = normalizeRedirectTarget(request.nextUrl.searchParams.get('next'));

  if (!tokenHash || !type) {
    return failureRedirect(request, nextPath);
  }

  const routeClient = createSupabaseRouteClient(request);
  const { supabase } = routeClient;
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return failureRedirect(request, nextPath);
  }

  const response = NextResponse.redirect(new URL(nextPath, request.url));
  return routeClient.setRedirectResponse(response);
}
