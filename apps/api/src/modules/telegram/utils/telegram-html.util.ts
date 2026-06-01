import type { Context } from 'telegraf';
import { startOfAppCalendarDay } from '@repo/shared';

/** Экранирование для Telegram HTML parse_mode. */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function splitTelegramHtml(text: string, max = 3900): string[] {
  const t = text.trim();
  if (t.length === 0) {
    return [];
  }
  if (t.length <= max) {
    return [t];
  }
  const parts: string[] = [];
  let rest = t;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const lastBreak = slice.lastIndexOf('\n');
    const cut = lastBreak > max * 0.4 ? lastBreak : max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) {
    parts.push(rest);
  }
  return parts;
}

/** Несколько HTML-сообщений под лимит длины Telegram. */
export async function replyTelegramHtmlChunks(
  ctx: Context,
  html: string,
): Promise<void> {
  const parts = splitTelegramHtml(html);
  for (const part of parts) {
    await ctx.reply(part, { parse_mode: 'HTML' });
  }
}

export function formatRuDate(d: Date): string {
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function startOfToday(): Date {
  return startOfAppCalendarDay();
}

export function todayDateKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
