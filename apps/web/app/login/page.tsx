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
    <div className="authCard">
      <h1 className="authCardTitle">Вход в SignalsBot</h1>
      <p className="authCardIntro">
        Войдите по email. Переключение между кабинетами — в шапке после входа.
      </p>
      {errorText(error) && <p className="msg err">{errorText(error)}</p>}
      <form className="authForm" action={withBasePath('/auth/login')} method="post">
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label className="authFormField">
          <span className="authFormLabel">Email</span>
          <input
            className="authInput"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
        </label>
        <label className="authFormField">
          <span className="authFormLabel">Пароль</span>
          <input
            className="authInput"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </label>
        <button type="submit" className="btn">
          Войти
        </button>
        <div className="authFormLinks">
          <a href={withBasePath('/signup')}>Регистрация</a>
          <a href={withBasePath('/forgot-password')}>Забыли пароль?</a>
        </div>
      </form>
    </div>
  );
}
