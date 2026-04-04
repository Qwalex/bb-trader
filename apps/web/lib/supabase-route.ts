import { createServerClient } from '@supabase/ssr';
import { NextResponse } from 'next/server';

import { getSupabaseAnonKey, getSupabaseUrl } from './supabase';

export function createSupabaseRouteClient(request: Request) {
  let response = NextResponse.next();
  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookies: {
      getAll() {
        const cookieHeader = request.headers.get('cookie') ?? '';
        return cookieHeader
          .split(';')
          .map((part) => part.trim())
          .filter(Boolean)
          .map((part) => {
            const [name, ...rest] = part.split('=');
            return { name, value: rest.join('=') };
          })
          .filter((cookie): cookie is { name: string; value: string } => Boolean(cookie.name));
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  return {
    supabase,
    getResponse() {
      return response;
    },
    setRedirectResponse(nextResponse: NextResponse) {
      response.cookies.getAll().forEach((cookie) => {
        nextResponse.cookies.set(cookie);
      });
      response = nextResponse;
      return response;
    },
  };
}
