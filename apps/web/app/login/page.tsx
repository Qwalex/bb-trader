'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login, password }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(json?.message ?? 'Не удалось выполнить вход');
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('Не удалось выполнить вход');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="pageTitle">Вход</h1>
      <div className="card" style={{ maxWidth: 420 }}>
        <p style={{ color: 'var(--muted)' }}>
          Войдите в общий аккаунт для работы с кабинетами и API.
        </p>
        {error ? <p className="msg err">{error}</p> : null}
        <div style={{ display: 'grid', gap: 12 }}>
          <input
            className="settingsAuthInput"
            placeholder="Логин"
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          <input
            className="settingsAuthInput"
            type="password"
            placeholder="Пароль"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !submitting && login.trim() && password.trim()) {
                void submit();
              }
            }}
          />
          <button
            className="btn"
            type="button"
            disabled={submitting || !login.trim() || !password.trim()}
            onClick={() => void submit()}
          >
            {submitting ? 'Вход...' : 'Войти'}
          </button>
        </div>
      </div>
    </>
  );
}

