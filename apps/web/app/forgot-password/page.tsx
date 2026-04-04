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
    redirect(withBasePath('/'));
  }
  const sp = await searchParams;
  const status = typeof sp.status === 'string' ? sp.status : undefined;
  const message = messageText(status);

  return (
    <div className="card" style={{ maxWidth: 420, margin: '3rem auto', padding: '1.2rem' }}>
      <h1 className="pageTitle" style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>
        Восстановление пароля
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Укажите email, и мы отправим ссылку для смены пароля.
      </p>
      {message && <p className={message.ok ? 'msg ok' : 'msg err'}>{message.text}</p>}
      <form action={withBasePath('/auth/forgot-password')} method="post" style={{ display: 'grid', gap: '0.8rem' }}>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Email</span>
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <button type="submit" className="btn">
          Отправить ссылку
        </button>
        <a href={withBasePath('/login')}>Вернуться ко входу</a>
      </form>
    </div>
  );
}
