'use client';

import { useState } from 'react';

function normalizeBasePath(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!t || t === '/') return '';
  return (t.startsWith('/') ? t : `/${t}`).replace(/\/+$/, '');
}

const appBasePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
function withAppBasePath(url: string): string {
  if (!url.startsWith('/')) return url;
  return `${appBasePath}${url}`;
}

type SessionInfoBarProps = {
  login?: string | null;
  userId?: string | null;
  cabinetName?: string | null;
};

export function SessionInfoBar({ login, userId, cabinetName }: SessionInfoBarProps) {
  const [busy, setBusy] = useState(false);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(withAppBasePath('/api/auth'), { method: 'DELETE' });
    } finally {
      try {
        window.localStorage.removeItem('active_cabinet_id');
      } catch {
        // ignore
      }
      window.location.href = withAppBasePath('/login');
    }
  }

  return (
    <div
      className="card"
      style={{
        marginBottom: '0.9rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ display: 'grid', gap: '0.25rem' }}>
        <div style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
          Логин: <strong style={{ color: 'var(--foreground)' }}>{login ?? '—'}</strong>
        </div>
        <div style={{ color: 'var(--muted)', fontSize: '0.88rem' }}>
          Текущий кабинет: <strong style={{ color: 'var(--foreground)' }}>{cabinetName ?? '—'}</strong>
        </div>
        {userId ? (
          <div style={{ color: 'var(--muted)', fontSize: '0.82rem' }}>
            user id: <code>{userId}</code>
          </div>
        ) : null}
      </div>
      <button type="button" className="btn btnSecondary" disabled={busy} onClick={() => void logout()}>
        {busy ? 'Выход…' : 'Выйти'}
      </button>
    </div>
  );
}

