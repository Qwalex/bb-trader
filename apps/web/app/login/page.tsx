import { redirect } from 'next/navigation';

import { withBasePath } from '../../lib/auth';
import { readDashboardSession } from '../../lib/server-auth';

function normalizeRedirectTarget(raw: string | undefined): string {
  const value = String(raw ?? '').trim();
  if (!value.startsWith('/')) {
    return withBasePath('/');
  }
  return value;
}

function errorText(code: string | undefined): string | null {
  if (code === 'invalid_credentials') {
    return 'Неверный логин или пароль.';
  }
  if (code === 'missing_auth_config') {
    return 'Не настроены AUTH_SESSION_SECRET / DASHBOARD_USERNAME / DASHBOARD_PASSWORD.';
  }
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readDashboardSession();
  if (session) {
    redirect(withBasePath('/'));
  }
  const sp = await searchParams;
  const error = typeof sp.error === 'string' ? sp.error : undefined;
  const redirectToRaw = typeof sp.redirectTo === 'string' ? sp.redirectTo : undefined;
  const redirectTo = normalizeRedirectTarget(redirectToRaw);

  return (
    <div
      className="card"
      style={{ maxWidth: 420, margin: '3rem auto', padding: '1.2rem' }}
    >
      <h1 className="pageTitle" style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>
        Вход в SignalsBot
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Авторизуйтесь, чтобы открыть дашборд и административные действия API.
      </p>
      {errorText(error) && <p className="msg err">{errorText(error)}</p>}
      <form
        action={withBasePath('/auth/login')}
        method="post"
        style={{ display: 'grid', gap: '0.8rem' }}
      >
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Логин</span>
          <input name="username" autoComplete="username" required />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Пароль</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
          />
        </label>
        <button type="submit" className="btn">
          Войти
        </button>
      </form>
    </div>
  );
}
