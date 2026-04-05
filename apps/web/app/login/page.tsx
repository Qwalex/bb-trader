import { redirect } from 'next/navigation';

import { withBasePath } from '../../lib/auth';
import { normalizeRedirectTarget } from '../../lib/redirect';
import { readDashboardSession } from '../../lib/server-auth';

function errorText(code: string | undefined): string | null {
  if (code === 'invalid_credentials' || code === 'auth_failed') {
    return 'Неверный email или пароль.';
  }
  if (code === 'missing_auth_config') {
    return 'Не настроены Supabase auth переменные.';
  }
  if (code === 'auth_callback_failed') {
    return 'Не удалось завершить вход по ссылке подтверждения.';
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
    redirect('/');
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
        Авторизуйтесь через email, чтобы открыть ваш кабинет и связанные данные.
      </p>
      {errorText(error) && <p className="msg err">{errorText(error)}</p>}
      <form
        action={withBasePath('/auth/login')}
        method="post"
        style={{ display: 'grid', gap: '0.8rem' }}
      >
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
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
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
          <a href={withBasePath('/signup')}>Регистрация</a>
          <a href={withBasePath('/forgot-password')}>Забыли пароль?</a>
        </div>
      </form>
    </div>
  );
}
