import { formatError } from '../../../common/format-error';

/**
 * Telegram MTProto: одна и та же сессия подключена из двух процессов (другая реплика API, локальный + прод и т.д.).
 */
export function isTelegramAuthKeyDuplicatedError(err: unknown): boolean {
  if (typeof err === 'object' && err !== null) {
    const o = err as { errorMessage?: unknown; message?: unknown };
    const em =
      (typeof o.errorMessage === 'string' ? o.errorMessage : null) ??
      (typeof o.message === 'string' ? o.message : null);
    if (em && /AUTH_KEY_DUPLICATED/i.test(em)) {
      return true;
    }
  }
  return /AUTH_KEY_DUPLICATED/i.test(formatError(err));
}
