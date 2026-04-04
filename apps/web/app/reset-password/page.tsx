import { withBasePath } from '../../lib/auth';

function messageText(code: string | undefined): { text: string; ok: boolean } | null {
  if (code === 'updated') {
    return { text: 'Пароль обновлён. Теперь можно войти с новым паролем.', ok: true };
  }
  if (code === 'failed') {
    return { text: 'Не удалось обновить пароль. Возможно, ссылка устарела.', ok: false };
  }
  return null;
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const status = typeof sp.status === 'string' ? sp.status : undefined;
  const message = messageText(status);

  return (
    <div className="card" style={{ maxWidth: 420, margin: '3rem auto', padding: '1.2rem' }}>
      <h1 className="pageTitle" style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>
        Новый пароль
      </h1>
      <p style={{ color: 'var(--muted)', marginBottom: '1rem' }}>
        Если вы открыли страницу из письма Supabase, задайте новый пароль ниже.
      </p>
      {message && <p className={message.ok ? 'msg ok' : 'msg err'}>{message.text}</p>}
      <form action={withBasePath('/auth/reset-password')} method="post" style={{ display: 'grid', gap: '0.8rem' }}>
        <label style={{ display: 'grid', gap: '0.35rem' }}>
          <span>Новый пароль</span>
          <input name="password" type="password" autoComplete="new-password" minLength={8} required />
        </label>
        <button type="submit" className="btn">
          Обновить пароль
        </button>
        <a href={withBasePath('/login')}>Вернуться ко входу</a>
      </form>
    </div>
  );
}
