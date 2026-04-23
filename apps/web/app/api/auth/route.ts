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
      userId?: string;
      login?: string;
      role?: string;
      exp?: number;
    };
    return NextResponse.json({
      authenticated: true,
      userId: payload.userId ?? null,
      login: payload.login ?? null,
      role: payload.role ?? null,
      exp: payload.exp ?? null,
    });
  } catch {
    return NextResponse.json({ authenticated: false });
  }
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | {
        action?: string;
        login?: string;
        password?: string;
        telegramUserId?: string;
        code?: string;
        newPassword?: string;
        unlockLogin?: string;
      }
    | null;
  const action = String(payload?.action ?? 'login').trim().toLowerCase();
  const login = String(payload?.login ?? '').trim();
  const password = String(payload?.password ?? '');

  const callApi = async (path: string, body: unknown) =>
    fetch(`${getApiBase()}${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  try {
    if (action === 'register') {
      const res = await callApi('/auth/register', {
        login,
        password,
        telegramUserId: String(payload?.telegramUserId ?? '').trim() || undefined,
      });
      const json = (await res.json().catch(() => null)) as
        | { id?: string; login?: string; role?: string; message?: string }
        | null;
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, message: json?.message ?? 'Не удалось зарегистрироваться' },
          { status: res.status || 400 },
        );
      }
      return NextResponse.json(
        {
          ok: true,
          user: {
            id: json?.id ?? null,
            login: json?.login ?? null,
            role: json?.role ?? null,
          },
        },
      );
    }

    if (action === 'request-reset') {
      const res = await callApi('/auth/password-reset/request', { login });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, message: json?.message ?? 'Не удалось отправить код' },
          { status: res.status || 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'confirm-reset') {
      const res = await callApi('/auth/password-reset/confirm', {
        login,
        code: String(payload?.code ?? '').trim(),
        newPassword: String(payload?.newPassword ?? ''),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, message: json?.message ?? 'Не удалось изменить пароль' },
          { status: res.status || 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'unlock') {
      const token = readCookieValue(request.headers.get('cookie') ?? '', AUTH_COOKIE);
      if (!token) {
        return NextResponse.json({ ok: false, message: 'Требуется вход' }, { status: 401 });
      }
      const unlockLogin = String(payload?.unlockLogin ?? '').trim();
      const res = await fetch(`${getApiBase()}/auth/users/unlock`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${decodeURIComponent(token)}`,
        },
        body: JSON.stringify({ login: unlockLogin }),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, message: json?.message ?? 'Не удалось разблокировать' },
          { status: res.status || 400 },
        );
      }
      return NextResponse.json({ ok: true });
    }

    if (!login || !password.trim()) {
      return NextResponse.json(
        { authenticated: false, message: 'Укажите login и password' },
        { status: 400 },
      );
    }
    const res = await callApi('/auth/login', { login, password });
    const json = (await res.json().catch(() => null)) as
      | { accessToken?: string; expiresInSeconds?: number; message?: string }
      | null;
    if (!res.ok || !json?.accessToken) {
      return NextResponse.json(
        {
          authenticated: false,
          message: json?.message ?? 'Неверный логин или пароль',
        },
        { status: res.status || 401 },
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

