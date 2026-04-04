import { NextResponse } from 'next/server';

import { createDashboardSessionToken } from '@repo/shared';

import {
  getDashboardCookieOptions,
  getDashboardPassword,
  getDashboardSessionSecret,
  getDashboardUsername,
  withBasePath,
} from '../../../lib/auth';

function normalizeRedirectTarget(raw: FormDataEntryValue | null): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value.startsWith('/')) {
    return withBasePath('/');
  }
  return value;
}

export async function POST(request: Request) {
  const form = await request.formData();
  const username = typeof form.get('username') === 'string' ? String(form.get('username')).trim() : '';
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
  const redirectTo = normalizeRedirectTarget(form.get('redirectTo'));

  try {
    const expectedUsername = getDashboardUsername();
    const expectedPassword = getDashboardPassword();
    const sessionSecret = getDashboardSessionSecret();
    if (username !== expectedUsername || password !== expectedPassword) {
      return NextResponse.redirect(
        new URL(
          `${withBasePath('/login')}?error=invalid_credentials&redirectTo=${encodeURIComponent(
            redirectTo,
          )}`,
          request.url,
        ),
      );
    }
    const token = await createDashboardSessionToken(sessionSecret, username);
    const response = NextResponse.redirect(new URL(redirectTo, request.url));
    response.cookies.set(getDashboardCookieOptions().name, token, getDashboardCookieOptions());
    return response;
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
