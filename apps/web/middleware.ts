import { NextResponse, type NextRequest } from 'next/server';

import { DASHBOARD_SESSION_COOKIE } from '@repo/shared';

import { readDashboardSessionFromToken } from './lib/auth';

function stripBasePath(pathname: string, basePath: string): string {
  if (!basePath) {
    return pathname || '/';
  }
  if (pathname === basePath) {
    return '/';
  }
  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || '/';
  }
  return pathname || '/';
}

function isPublicPath(pathname: string): boolean {
  if (
    pathname === '/login' ||
    pathname.startsWith('/auth/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js'
  ) {
    return true;
  }
  if (pathname.startsWith('/_next/') || pathname.startsWith('/icons/')) {
    return true;
  }
  return pathname.includes('.');
}

export async function middleware(request: NextRequest) {
  const basePath = request.nextUrl.basePath ?? '';
  const pathname = stripBasePath(request.nextUrl.pathname, basePath);
  const isPublic = isPublicPath(pathname);
  const session = await readDashboardSessionFromToken(
    request.cookies.get(DASHBOARD_SESSION_COOKIE)?.value ?? null,
  );

  if (!session && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = `${basePath}/login`;
    loginUrl.searchParams.set(
      'redirectTo',
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  if (session && pathname === '/login') {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `${basePath}/`;
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
