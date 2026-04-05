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
    <div className="card" style={{ maxWidth: 420, margin: '3rem auto', padding: '1.2rem' }}>
      <h1 className="pageTitle" style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>
        Регистрация
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Создайте аккаунт, чтобы получить собственный кабинет и изолированные данные.
      </p>
      {errorText(error) && (
        <p className={error === 'confirmation_required' ? 'msg ok' : 'msg err'}>{errorText(error)}</p>
      )}
      <form action={withBasePath('/auth/signup')} method="post" style={{ display: 'grid', gap: '0.8rem' }}>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Пароль</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </label>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Имя кабинета</span>
          <input name="workspaceName" autoComplete="organization" required />
        </label>
        <button type="submit" className="btn">
          Создать аккаунт
        </button>
        <a href={withBasePath('/login')}>Уже есть аккаунт? Войти</a>
      </form>
    </div>
  );
}
