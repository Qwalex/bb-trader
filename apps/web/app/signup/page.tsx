import { redirect } from 'next/navigation';

import { withBasePath } from '../../lib/auth';
import { readDashboardSession } from '../../lib/server-auth';

function errorText(code: string | undefined): string | null {
  if (code === 'signup_failed') {
    return 'Не удалось создать пользователя. Проверьте email и пароль.';
  }
  if (code === 'confirmation_required') {
    return 'Пользователь создан. Подтвердите email через письмо, затем войдите.';
  }
  return null;
}

export default async function SignupPage({
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

  return (
    <div className="authCard">
      <h1 className="authCardTitle">Регистрация</h1>
      <p className="authCardIntro">
        Создайте аккаунт, чтобы получить собственный кабинет и изолированные данные.
      </p>
      {errorText(error) && (
        <p className={error === 'confirmation_required' ? 'msg ok' : 'msg err'}>{errorText(error)}</p>
      )}
      <form className="authForm" action={withBasePath('/auth/signup')} method="post">
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
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            placeholder="Не менее 8 символов"
            required
          />
        </label>
        <label className="authFormField">
          <span className="authFormLabel">Имя кабинета</span>
          <input
            className="authInput"
            name="workspaceName"
            autoComplete="organization"
            placeholder="Например, мой трейдинг"
            required
          />
        </label>
        <button type="submit" className="btn">
          Создать аккаунт
        </button>
        <a className="authFormFooterLink" href={withBasePath('/login')}>
          Уже есть аккаунт? Войти
        </a>
      </form>
    </div>
  );
}
