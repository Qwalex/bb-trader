/**
 * Сообщения для UI/логов при ошибках auth во время QR-входа (GramJS / MTProto).
 */
export function formatUserbotQrAuthErrorForUser(technical: string): string {
  const t = technical.toUpperCase();
  if (t.includes('PASSWORD_HASH_INVALID')) {
    return (
      'Неверный пароль облака Telegram (2FA). Нужен именно «Облачный пароль» из приложения: ' +
      'Настройки → Конфиденциальность → Облачный пароль (не PIN-код экрана блокировки). ' +
      'Проверьте раскладку и Caps Lock. После ошибки отмените QR и начните вход заново.'
    );
  }
  if (t.includes('PASSWORD_EMPTY') || t.includes('PASSWORD_REQUIRED')) {
    return 'Telegram запросил облачный пароль, но он не был передан. Повторите вход по QR.';
  }
  if (t.includes('SESSION_PASSWORD_NEEDED')) {
    return 'Требуется облачный пароль (2FA). Введите пароль в форме на странице userbot.';
  }
  return technical;
}

/** Нормализация введённого облачного пароля перед отправкой в GramJS. */
export function normalizeCloudPasswordInput(raw: string): string {
  const s = String(raw ?? '');
  try {
    return s.normalize('NFC').trim();
  } catch {
    return s.trim();
  }
}
