import { redirect } from 'next/navigation';

import { withBasePath } from '../../lib/auth';
import { readDashboardSession } from '../../lib/server-auth';

function messageText(code: string | undefined): { text: string; ok: boolean } | null {
  if (code === 'sent') {
    return { text: 'Если аккаунт существует, письмо со ссылкой для сброса отправлено.', ok: true };
  }
  if (code === 'failed') {
    return { text: 'Не удалось отправить письмо для сброса пароля.', ok: false };
  }
  return null;
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await readDashboardSession();
  if (session) {
    redirect('/');
  }
  const sp = await searchParams;
  const status = typeof sp.status === 'string' ? sp.status : undefined;
  const message = messageText(status);

  return (
    <div className="authCard">
      <h1 className="authCardTitle">Восстановление пароля</h1>
      <p className="authCardIntro">Укажите email, и мы отправим ссылку для смены пароля.</p>
      {message && <p className={message.ok ? 'msg ok' : 'msg err'}>{message.text}</p>}
      <form className="authForm" action={withBasePath('/auth/forgot-password')} method="post">
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
        <button type="submit" className="btn">
          Отправить ссылку
        </button>
        <a className="authFormFooterLink" href={withBasePath('/login')}>
          Вернуться ко входу
        </a>
      </form>
    </div>
  );
}
