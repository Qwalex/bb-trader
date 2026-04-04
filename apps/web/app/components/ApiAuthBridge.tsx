'use client';

import { useEffect } from 'react';

import { createSupabaseBrowserClient } from '../../lib/supabase';
import { getApiBase } from '../../lib/api';

export function ApiAuthBridge(props: {
  supabaseUrl: string;
  supabaseAnonKey: string;
}) {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    const supabase = createSupabaseBrowserClient(
      props.supabaseUrl,
      props.supabaseAnonKey,
    );
    const apiBase = getApiBase();

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      if (!requestUrl.startsWith(apiBase)) {
        return originalFetch(input, init);
      }

      const headers = new Headers(init?.headers);
      const hasAuthorization = headers.has('Authorization');
      if (!hasAuthorization) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers.set('Authorization', `Bearer ${session.access_token}`);
        }
      }
      return originalFetch(input, {
        ...init,
        headers,
      });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [props.supabaseAnonKey, props.supabaseUrl]);

  return null;
}
