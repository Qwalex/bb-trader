/** Задержки между повторным sync после неудачного launch (мс), по нарастающей. */
export const TELEGRAM_CABINET_LAUNCH_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

export function makeTelegramBotLaunchCorrelationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function makeTelegramBotSyncCorrelationId(): string {
  return `sync-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Маска токена для логов (не логировать полный секрет). */
export function maskTelegramBotToken(token: string): string {
  const t = String(token ?? '').trim();
  if (t.length <= 8) {
    return t ? '***' : '';
  }
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

export type TelegramLaunchTimedOutPhase =
  | 'unknown'
  | 'delete_webhook'
  | 'telegraf_launch';
