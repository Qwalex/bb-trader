import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

const AUTH_COOKIE = 'sb_auth';

function isPublicPath(pathname: string): boolean {
  if (pathname === '/login') return true;
  if (pathname.startsWith('/api/auth')) return true;
  if (pathname.startsWith('/api/settings-auth')) return true;
  if (pathname === '/health') return true;
  if (pathname === '/robots.txt') return true;
  if (pathname.startsWith('/_next/')) return true;
  if (pathname.startsWith('/icons/')) return true;
  if (pathname === '/manifest.webmanifest') return true;
  return false;
}

export function middleware(req: NextRequest) {
  if (isPublicPath(req.nextUrl.pathname)) {
    return NextResponse.next();
  }
  const token = req.cookies.get(AUTH_COOKIE)?.value?.trim();
  if (token) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: '/:path*',
};

