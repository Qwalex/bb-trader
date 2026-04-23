'use client';

import { useEffect } from 'react';

function readAuthTokenFromCookie(): string | null {
  const raw = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('sb_auth_token='))
    ?.slice('sb_auth_token='.length);
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function normalizeApiBase(raw: string | undefined): string {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

export function ApiAuthFetchBridge() {
  useEffect(() => {
    const apiBase = normalizeApiBase(process.env.NEXT_PUBLIC_API_URL);
    const originalFetch = window.fetch.bind(window);

    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      const shouldAttachAuth =
        requestUrl.startsWith('/trade-api') ||
        requestUrl.startsWith(`${window.location.origin}/trade-api`) ||
        (apiBase.length > 0 && requestUrl.startsWith(apiBase));

      if (!shouldAttachAuth) {
        return originalFetch(input, init);
      }

      const token = readAuthTokenFromCookie();
      if (!token) {
        return originalFetch(input, init);
      }

      const headers = new Headers(init?.headers ?? undefined);
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }

      return originalFetch(input, {
        ...init,
        headers,
      });
    }) as typeof window.fetch;

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}

