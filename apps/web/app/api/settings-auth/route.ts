import { createHash, timingSafeEqual } from 'node:crypto';

import { NextResponse } from 'next/server';

const COOKIE_NAME = 'settings_access';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 8;

function isPasswordConfigured(): boolean {
  return Boolean(process.env.SETTINGS_PAGE_PASSWORD?.trim());
}

function buildApiAuthHeader(): Record<string, string> {
  const token = process.env.NEXT_PUBLIC_API_ACCESS_TOKEN?.trim();
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isAuthenticated(cookieValue: string | undefined): boolean {
  const expected = process.env.SETTINGS_PAGE_PASSWORD?.trim() ?? '';
  if (!expected) return false;
  return cookieValue === hashValue(expected);
}

function safePasswordEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export async function GET(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const cookieValue = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))
    ?.slice(`${COOKIE_NAME}=`.length);

  const localAuth = isAuthenticated(cookieValue);
  if (!localAuth) {
    return NextResponse.json({
      enabled: isPasswordConfigured(),
      authenticated: false,
    });
  }

  try {
    const apiBase = process.env.API_INTERNAL_URL?.replace(/\/$/, '');
    if (!apiBase) {
      return NextResponse.json({
        enabled: isPasswordConfigured(),
        authenticated: localAuth,
      });
    }
    const probe = await fetch(`${apiBase}/health`, {
      cache: 'no-store',
      headers: buildApiAuthHeader(),
    });
    if (!probe.ok) {
      return NextResponse.json({
        enabled: isPasswordConfigured(),
        authenticated: false,
      });
    }
    return NextResponse.json({
      enabled: isPasswordConfigured(),
      authenticated: true,
    });
  } catch {
    return NextResponse.json({
      enabled: isPasswordConfigured(),
      authenticated: false,
    });
  }
}

export async function POST(request: Request) {
  const configuredPassword = process.env.SETTINGS_PAGE_PASSWORD?.trim() ?? '';
  if (!configuredPassword) {
    return NextResponse.json(
      {
        authenticated: false,
        enabled: false,
        message: 'Пароль для страницы настроек не настроен на web-сервере',
      },
      { status: 503 },
    );
  }

  const payload = (await request.json().catch(() => null)) as { password?: string } | null;
  const password = payload?.password?.trim() ?? '';
  const ok = safePasswordEquals(password, configuredPassword);

  if (!ok) {
    return NextResponse.json(
      { authenticated: false, enabled: true, message: 'Неверный пароль' },
      { status: 401 },
    );
  }

  const response = NextResponse.json({ authenticated: true, enabled: true });
  response.cookies.set(COOKIE_NAME, hashValue(configuredPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });

  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
