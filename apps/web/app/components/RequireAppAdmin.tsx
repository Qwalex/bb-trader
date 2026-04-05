'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { getApiBase } from '../../lib/api';
import { withBasePath } from '../../lib/auth';

type Props = { children: React.ReactNode };

/**
 * Раздел только для appRole=admin (UserProfile). Совпадает с adminOnly в lib/nav-items.
 */
export function RequireAppAdmin({ children }: Props) {
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden'>('loading');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${getApiBase()}/settings/ui`);
        if (cancelled) return;
        if (!res.ok) {
          setState('forbidden');
          return;
        }
        const data = (await res.json()) as { appRole?: string };
        setState(data.appRole === 'admin' ? 'ok' : 'forbidden');
      } catch {
        if (!cancelled) setState('forbidden');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') {
    return <p style={{ color: 'var(--muted)' }}>Загрузка…</p>;
  }
  if (state === 'forbidden') {
    return (
      <div className="card" style={{ padding: '1.25rem' }}>
        <h1 className="pageTitle">Доступ ограничен</h1>
        <p style={{ color: 'var(--muted)' }}>
          Этот раздел доступен только администраторам приложения (app-admin).
        </p>
        <p>
          <Link href={withBasePath('/')}>На главную</Link>
        </p>
      </div>
    );
  }
  return <>{children}</>;
}
