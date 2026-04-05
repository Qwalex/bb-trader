import { type EmailOtpType } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

import { withBasePath } from '../../../lib/auth';
import { normalizeRedirectTarget } from '../../../lib/redirect';
import { getPublicOrigin } from '../../../lib/public-origin';
import { createSupabaseRouteClient } from '../../../lib/supabase-route';

function failureRedirect(
  request: NextRequest,
  nextPath: string,
  reason: 'missing_params' | 'otp_invalid',
): NextResponse {
  const origin = getPublicOrigin(request);
  if (nextPath === withBasePath('/reset-password')) {
    return NextResponse.redirect(
      new URL(`${withBasePath('/reset-password')}?status=failed`, origin),
    );
  }

  // Почтовые клиенты часто один раз открывают ссылку сами — токен уже израсходован,
  // но email уже подтверждён. Не показываем «ошибку входа», а подсказку на /login.
  if (reason === 'otp_invalid') {
    return NextResponse.redirect(
      new URL(`${withBasePath('/login')}?notice=confirm_link_used`, origin),
    );
  }

  return NextResponse.redirect(
    new URL(`${withBasePath('/login')}?error=auth_callback_failed`, origin),
  );
}

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const nextPath = normalizeRedirectTarget(request.nextUrl.searchParams.get('next'));

  if (!tokenHash || !type) {
    return failureRedirect(request, nextPath, 'missing_params');
  }

  const routeClient = createSupabaseRouteClient(request);
  const { supabase } = routeClient;
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type,
  });

  if (error) {
    return failureRedirect(request, nextPath, 'otp_invalid');
  }

  const response = NextResponse.redirect(new URL(nextPath, getPublicOrigin(request)));
  return routeClient.setRedirectResponse(response);
}
