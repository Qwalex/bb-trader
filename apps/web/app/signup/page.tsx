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

function resendText(code: string | undefined): string | null {
  if (code === 'ok') {
    return 'Письмо с подтверждением отправлено повторно. Проверьте входящие и папку «Спам».';
  }
  if (code === 'failed') {
    return 'Не удалось отправить письмо. Подождите минуту и попробуйте снова или проверьте адрес.';
  }
  if (code === 'missing_email') {
    return 'Укажите email, на который регистрировались.';
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
  const resend = typeof sp.resend === 'string' ? sp.resend : undefined;
  const prefillEmail = typeof sp.email === 'string' ? sp.email : '';

  const resendOpen =
    error === 'confirmation_required' ||
    resend === 'ok' ||
    resend === 'failed' ||
    resend === 'missing_email';

  return (
    <div className="authCard">
      <h1 className="authCardTitle">Регистрация</h1>
      <p className="authCardIntro">
        Создайте аккаунт: первый кабинет с выбранным логином. Дополнительные кабинеты с тем же email
        можно добавить после входа в меню «Кабинет».
      </p>
      {errorText(error) && (
        <p className={error === 'confirmation_required' ? 'msg ok' : 'msg err'}>{errorText(error)}</p>
      )}
      {resendText(resend) && (
        <p className={resend === 'ok' ? 'msg ok' : 'msg err'}>{resendText(resend)}</p>
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
            defaultValue={prefillEmail}
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
          <span className="authFormLabel">Логин</span>
          <input
            className="authInput"
            name="workspaceName"
            autoComplete="username"
            placeholder="Например, основной-счёт"
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

      <details className="authResendBlock" open={resendOpen}>
        <summary className="authResendSummary">Не пришло письмо с подтверждением?</summary>
        <p className="authResendHint">
          Укажите тот же email — отправим ссылку для подтверждения ещё раз.
        </p>
        <form className="authForm" action={withBasePath('/auth/resend-confirmation')} method="post">
          <label className="authFormField">
            <span className="authFormLabel">Email</span>
            <input
              className="authInput"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              defaultValue={prefillEmail}
              required
            />
          </label>
          <button type="submit" className="btn btnSecondary">
            Отправить письмо снова
          </button>
        </form>
      </details>
    </div>
  );
}
