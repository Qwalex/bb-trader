'use client';

import { useEffect } from 'react';

import { ACTIVE_WORKSPACE_STORAGE_KEY } from '../../lib/active-workspace';
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
      if (!headers.has('X-Workspace-Id')) {
        try {
          const wid = localStorage.getItem(ACTIVE_WORKSPACE_STORAGE_KEY)?.trim();
          if (wid) {
            headers.set('X-Workspace-Id', wid);
          }
        } catch {
          // ignore (private mode / SSR guard)
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
