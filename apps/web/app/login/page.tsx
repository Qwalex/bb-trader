'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type AuthMode = 'login' | 'register' | 'reset';

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

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [telegramUserId, setTelegramUserId] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'login'
            ? { action: 'login', login, password }
            : {
                action: 'register',
                login,
                password,
                telegramUserId,
              },
        ),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { message?: string } | null;
        setError(json?.message ?? 'Не удалось выполнить вход');
        return;
      }
      if (mode === 'login') {
        const nextUrl = withAppBasePath('/');
        router.replace(nextUrl);
        router.refresh();
        window.location.assign(nextUrl);
        return;
      }
      setOk('Регистрация выполнена. Теперь войдите.');
      setMode('login');
    } catch {
      setError('Не удалось выполнить вход');
    } finally {
      setSubmitting(false);
    }
  }

  async function requestResetCode() {
    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-reset', login }),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setError(json?.message ?? 'Не удалось отправить код');
        return;
      }
      setOk('Код отправлен в ассистент-бот.');
    } catch {
      setError('Не удалось отправить код');
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmResetCode() {
    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'confirm-reset',
          login,
          code: resetCode,
          newPassword,
        }),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setError(json?.message ?? 'Не удалось изменить пароль');
        return;
      }
      setOk('Пароль изменён. Войдите с новым паролем.');
      setMode('login');
      setResetCode('');
      setNewPassword('');
    } catch {
      setError('Не удалось изменить пароль');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="pageTitle">Вход</h1>
      <div className="card" style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="btn" type="button" onClick={() => setMode('login')}>
            Login
          </button>
          <button className="btn" type="button" onClick={() => setMode('register')}>
            Register
          </button>
          <button className="btn" type="button" onClick={() => setMode('reset')}>
            Reset
          </button>
        </div>
        <p style={{ color: 'var(--muted)' }}>
          {mode === 'login'
            ? 'Войдите в аккаунт для работы с кабинетами и API.'
            : mode === 'register'
              ? 'Создайте новый аккаунт.'
              : 'Восстановите пароль через код из ассистент-бота.'}
        </p>
        {error ? <p className="msg err">{error}</p> : null}
        {ok ? <p className="msg ok">{ok}</p> : null}
        <div style={{ display: 'grid', gap: 12 }}>
          <input
            className="settingsAuthInput"
            placeholder="Логин"
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          {mode !== 'reset' ? (
            <input
              className="settingsAuthInput"
              type="password"
              placeholder="Пароль"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          ) : null}
          {mode === 'register' ? (
            <input
              className="settingsAuthInput"
              placeholder="Telegram user id"
              value={telegramUserId}
              onChange={(e) => setTelegramUserId(e.target.value)}
            />
          ) : null}
          {mode === 'reset' ? (
            <>
              <button
                className="btn"
                type="button"
                disabled={submitting || !login.trim()}
                onClick={() => void requestResetCode()}
              >
                {submitting ? 'Отправка...' : 'Отправить код в бота'}
              </button>
              <input
                className="settingsAuthInput"
                placeholder="Код из бота"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
              />
              <input
                className="settingsAuthInput"
                type="password"
                placeholder="Новый пароль"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                disabled={submitting || !login.trim() || !resetCode.trim() || !newPassword.trim()}
                onClick={() => void confirmResetCode()}
              >
                {submitting ? 'Сохранение...' : 'Подтвердить смену пароля'}
              </button>
            </>
          ) : (
            <button
              className="btn"
              type="button"
              disabled={submitting || !login.trim() || !password.trim()}
              onClick={() => void submit()}
            >
              {submitting ? 'Обработка...' : mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
            </button>
          )}
        </div>
      </div>
    </>
  );
}

