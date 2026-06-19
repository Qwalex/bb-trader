'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { withAppBasePath } from '../../lib/base-path';
import { LanguageSwitcher, useI18n } from '../../lib/i18n/client';

type AuthMode = 'login' | 'register' | 'reset';

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
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
      const res = await fetch(withAppBasePath('/api/auth'), {
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
        setError(json?.message ?? t('login.errorLogin'));
        return;
      }
      if (mode === 'login') {
        const nextUrl = withAppBasePath('/');
        router.replace(nextUrl);
        router.refresh();
        window.location.assign(nextUrl);
        return;
      }
      setOk(t('login.registerOk'));
      setMode('login');
    } catch {
      setError(t('login.errorLogin'));
    } finally {
      setSubmitting(false);
    }
  }

  async function requestResetCode() {
    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(withAppBasePath('/api/auth'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request-reset', login }),
      });
      const json = (await res.json().catch(() => null)) as { message?: string } | null;
      if (!res.ok) {
        setError(json?.message ?? t('login.errorResetSend'));
        return;
      }
      setOk(t('login.resetCodeOk'));
    } catch {
      setError(t('login.errorResetSend'));
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmResetCode() {
    setSubmitting(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(withAppBasePath('/api/auth'), {
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
        setError(json?.message ?? t('login.errorResetConfirm'));
        return;
      }
      setOk(t('login.resetOk'));
      setMode('login');
      setResetCode('');
      setNewPassword('');
    } catch {
      setError(t('login.errorResetConfirm'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.5rem' }}>
        <h1 className="pageTitle" style={{ margin: 0 }}>{t('login.title')}</h1>
        <LanguageSwitcher />
      </div>
      <div className="card" style={{ maxWidth: 420 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="btn" type="button" onClick={() => setMode('login')}>
            {t('login.loginTab')}
          </button>
          <button className="btn" type="button" onClick={() => setMode('register')}>
            {t('login.registerTab')}
          </button>
          <button className="btn" type="button" onClick={() => setMode('reset')}>
            {t('login.resetTab')}
          </button>
        </div>
        <p style={{ color: 'var(--muted)' }}>
          {mode === 'login'
            ? t('login.loginHint')
            : mode === 'register'
              ? t('login.registerHint')
              : t('login.resetHint')}
        </p>
        {error ? <p className="msg err">{error}</p> : null}
        {ok ? <p className="msg ok">{ok}</p> : null}
        <div style={{ display: 'grid', gap: 12 }}>
          <input
            className="settingsAuthInput"
            placeholder={t('login.loginPlaceholder')}
            autoComplete="username"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
          {mode !== 'reset' ? (
            <input
              className="settingsAuthInput"
              type="password"
              placeholder={t('login.passwordPlaceholder')}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          ) : null}
          {mode === 'register' ? (
            <input
              className="settingsAuthInput"
              placeholder={t('login.telegramUserIdPlaceholder')}
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
                {submitting ? t('login.sending') : t('login.submitResetRequest')}
              </button>
              <input
                className="settingsAuthInput"
                placeholder={t('login.resetCodePlaceholder')}
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
              />
              <input
                className="settingsAuthInput"
                type="password"
                placeholder={t('login.newPasswordPlaceholder')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button
                className="btn"
                type="button"
                disabled={submitting || !login.trim() || !resetCode.trim() || !newPassword.trim()}
                onClick={() => void confirmResetCode()}
              >
                {submitting ? t('login.saving') : t('login.submitResetConfirm')}
              </button>
            </>
          ) : (
            <button
              className="btn"
              type="button"
              disabled={submitting || !login.trim() || !password.trim()}
              onClick={() => void submit()}
            >
              {submitting
                ? t('login.submitting')
                : mode === 'login'
                  ? t('login.submitLogin')
                  : t('login.submitRegister')}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
