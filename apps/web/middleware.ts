import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';

import { normalizeBasePath } from './lib/auth';
import { getSupabaseAnonKey, getSupabaseUrl } from './lib/supabase';

/** Совпадает с basePath из next.config (NEXT_BASE_PATH на этапе сборки). */
const appBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);

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
    pathname === '/signup' ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/offline' ||
    pathname.startsWith('/auth/') ||
    pathname === '/favicon.ico' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname === '/window.svg' ||
    pathname === '/vercel.svg' ||
    pathname === '/turborepo-light.svg' ||
    pathname === '/turborepo-dark.svg' ||
    pathname === '/next.svg' ||
    pathname === '/globe.svg' ||
    pathname === '/file-text.svg'
  ) {
    return true;
  }
  if (pathname.startsWith('/_next/') || pathname.startsWith('/icons/')) {
    return true;
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const basePath = appBasePath;
  const pathname = stripBasePath(request.nextUrl.pathname, basePath);
  const isPublic = isPublicPath(pathname);
  let response = NextResponse.next({
    request: { headers: request.headers },
  });
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublic) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = `${basePath}/login`;
    // pathname выше — без basePath; для hidden redirectTo нужен полный путь от origin (иначе "/" → потеря префикса).
    const redirectAfterLogin = basePath ? `${basePath}${pathname}` : pathname;
    loginUrl.searchParams.set(
      'redirectTo',
      `${redirectAfterLogin}${request.nextUrl.search}`,
    );
    return NextResponse.redirect(loginUrl);
  }

  if (
    user &&
    (pathname === '/login' ||
      pathname === '/signup' ||
      pathname === '/forgot-password')
  ) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = `${basePath}/`;
    redirectUrl.search = '';
    return NextResponse.redirect(redirectUrl);
  }

  return response;
}

// Next.js 16: matcher должен быть статическим (без шаблонов из env). При basePath сопоставление
// идёт с pathname без префикса basePath — см. https://nextjs.org/docs/app/building-your-application/routing/middleware#matcher
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)', '/'],
};
