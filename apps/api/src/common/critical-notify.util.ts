import { formatError } from './format-error';

import { CRITICAL_NOTIFY_URL } from './critical-notify.constants';

/**
 * POST `{ text }` на CRITICAL_NOTIFY_URL (контракт как в userbot critical notify).
 * Ошибки только через logWarn — не бросает.
 */
export async function postCriticalNotifyText(
  text: string,
  logWarn: (message: string) => void,
): Promise<void> {
  try {
    const res = await fetch(CRITICAL_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      logWarn(`critical notify failed: status=${res.status}`);
    }
  } catch (e) {
    logWarn(`critical notify error: ${formatError(e)}`);
  }
}
