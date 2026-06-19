import { NextResponse } from 'next/server';

import { isLocale, LOCALE_COOKIE } from '../../../lib/i18n/constants';

export async function POST(req: Request) {
  let body: { locale?: string } = {};
  try {
    body = (await req.json()) as { locale?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const locale = body.locale?.trim();
  if (!isLocale(locale)) {
    return NextResponse.json({ ok: false, error: 'Unsupported locale' }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 31536000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
  return res;
}
