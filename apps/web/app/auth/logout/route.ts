import { NextResponse } from 'next/server';

import { getDashboardCookieOptions, withBasePath } from '../../../lib/auth';

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL(withBasePath('/login'), request.url));
  response.cookies.set(getDashboardCookieOptions().name, '', {
    ...getDashboardCookieOptions(),
    maxAge: 0,
  });
  return response;
}
