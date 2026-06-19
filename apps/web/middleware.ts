import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { normalizeBasePath } from './lib/base-path';

const AUTH_COOKIE = 'sb_auth';
const CABINET_COOKIE = 'cabinet_id';
const configuredBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

/** Дублирует выбор кабинета из query в cookie для SSR (страницы вроде `/trades`). */
function applyCabinetCookieFromQuery(req: NextRequest, res: NextResponse): void {
  const fromQuery = req.nextUrl.searchParams.get('cabinetId')?.trim() ?? '';
  if (!fromQuery) return;
  res.cookies.set(CABINET_COOKIE, fromQuery, {
    path: '/',
    maxAge: 31536000,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function stripBasePath(pathname: string): string {
  if (!configuredBasePath) {
    return pathname;
  }
  if (pathname === configuredBasePath) {
    return '/';
  }
  if (pathname.startsWith(`${configuredBasePath}/`)) {
    return pathname.slice(configuredBasePath.length) || '/';
  }
  return pathname;
}

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith('/api/locale')) return true;
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/auth')) return true;
  if (pathname.startsWith('/api/backend')) return true;
  if (pathname.startsWith('/api/settings-auth')) return true;
  if (pathname === '/health') return true;
  if (pathname === '/robots.txt') return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/icons/')) return true;
  if (pathname === '/manifest.webmanifest') return true;
  return false;
}

export function middleware(req: NextRequest) {
  const normalizedPath = stripBasePath(req.nextUrl.pathname);
  if (isPublicPath(normalizedPath)) {
    return NextResponse.next();
  }
  const token = req.cookies.get(AUTH_COOKIE)?.value?.trim();
  if (token) {
    const res = NextResponse.next();
    applyCabinetCookieFromQuery(req, res);
    return res;
  }
  const url = req.nextUrl.clone();
  url.pathname = configuredBasePath ? `${configuredBasePath}/login` : '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: '/:path*',
};

