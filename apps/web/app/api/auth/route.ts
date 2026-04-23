import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'sb_auth';
const AUTH_TOKEN_COOKIE = 'sb_auth_token';
const AUTH_MAX_AGE_SECONDS = 60 * 60 * 8;

function getApiBase(): string {
  return (
    process.env.API_INTERNAL_URL?.replace(/\/$/, '') ??
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
    'http://api:3001'
  );
}

function readCookieValue(cookieHeader: string, key: string): string | undefined {
  return cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${key}=`))
    ?.slice(`${key}=`.length);
}

function clearAuthCookies(response: NextResponse): void {
  response.cookies.set(AUTH_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set(AUTH_TOKEN_COOKIE, '', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function GET(request: Request) {
  const cookieHeader = request.headers.get('cookie') ?? '';
  const tokenRaw = readCookieValue(cookieHeader, AUTH_COOKIE);
  const token = tokenRaw ? decodeURIComponent(tokenRaw) : '';
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }
  try {
    const probe = await fetch(`${getApiBase()}/auth/me`, {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!probe.ok) {
      const response = NextResponse.json({ authenticated: false });
      clearAuthCookies(response);
      return response;
    }
    const payload = (await probe.json()) as {
      login?: string;
      exp?: number;
    };
    return NextResponse.json({
      authenticated: true,
      login: payload.login ?? null,
      exp: payload.exp ?? null,
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | { login?: string; password?: string }
    | null;
  const login = String(payload?.login ?? '').trim();
  const password = String(payload?.password ?? '').trim();
  if (!login || !password) {
    return NextResponse.json(
      { authenticated: false, message: 'Укажите login и password' },
      { status: 400 },
    );
  }
  try {
    const res = await fetch(`${getApiBase()}/auth/login`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login, password }),
    });
    const json = (await res.json().catch(() => null)) as
      | { accessToken?: string; expiresInSeconds?: number; message?: string }
      | null;
    if (!res.ok || !json?.accessToken) {
      return NextResponse.json(
        {
          authenticated: false,
          message: json?.message ?? 'Неверный логин или пароль',
        },
        { status: 401 },
      );
    }
    const response = NextResponse.json({
      authenticated: true,
      expiresInSeconds: json.expiresInSeconds ?? AUTH_MAX_AGE_SECONDS,
    });
    const token = json.accessToken;
    const maxAge = Math.max(
      60,
      Number.isFinite(json.expiresInSeconds)
        ? Number(json.expiresInSeconds)
        : AUTH_MAX_AGE_SECONDS,
    );
    response.cookies.set(AUTH_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    response.cookies.set(AUTH_TOKEN_COOKIE, token, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge,
    });
    return response;
  } catch {
    return NextResponse.json(
      {
        authenticated: false,
        message: 'Не удалось выполнить вход',
      },
      { status: 502 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearAuthCookies(response);
  return response;
}

