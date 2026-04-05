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
    <div className="authCard">
      <h1 className="authCardTitle">Новый пароль</h1>
      <p className="authCardIntro">
        Если вы открыли страницу из письма Supabase, задайте новый пароль ниже.
      </p>
      {message && <p className={message.ok ? 'msg ok' : 'msg err'}>{message.text}</p>}
      <form className="authForm" action={withBasePath('/auth/reset-password')} method="post">
        <label className="authFormField">
          <span className="authFormLabel">Новый пароль</span>
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
        <button type="submit" className="btn">
          Обновить пароль
        </button>
        <a className="authFormFooterLink" href={withBasePath('/login')}>
          Вернуться ко входу
        </a>
      </form>
    </div>
  );
}
