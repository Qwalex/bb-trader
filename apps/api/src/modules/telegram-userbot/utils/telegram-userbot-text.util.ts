import { normalizeTradingPair } from '@repo/shared';

/** U+1F510 — если в тексте больше 5 раз, не считаем сообщение торговым. */
export function countLockEmojiInText(text: string): number {
  const m = text.match(/\u{1F510}/gu);
  return m ? m.length : 0;
}

export function makeTextPreview(text: string, max = 180): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, max)}...`;
}

export function extractTokenHint(text: string): string {
  const m = text.match(/\b([A-Z0-9]{2,15}USDT)\b/i);
  if (m?.[1]) {
    return m[1].toUpperCase();
  }
  const firstWord = text
    .trim()
    .split(/\s+/)[0]
    ?.replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return firstWord || 'UNKNOWN';
}

/**
 * Пара из result-сообщения без цитаты (например «RENDER SCALP TRADE» + «TARGET 1 Hit»).
 * null — не удалось определить токен.
 */
export function extractPairFromResultMessage(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const usdtMatch = trimmed.match(/\b([A-Z0-9]{2,20}USDT)\b/i);
  if (usdtMatch?.[1]) {
    return normalizeTradingPair(usdtMatch[1]);
  }

  const firstLine = trimmed.split(/\n/)[0]?.trim() ?? '';
  const tradeLineMatch = firstLine.match(
    /^([A-Z0-9]{2,15})\s+(?:SCALP|SWING|SPOT|FUTURES?)\s+TRADE\b/i,
  );
  if (tradeLineMatch?.[1]) {
    return normalizeTradingPair(`${tradeLineMatch[1]}USDT`);
  }

  const firstWord = firstLine
    .split(/\s+/)[0]
    ?.replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  if (!firstWord || firstWord.length < 2) {
    return null;
  }
  const normalized = normalizeTradingPair(firstWord);
  if (normalized.endsWith('USDT')) {
    return normalized;
  }
  return normalizeTradingPair(`${normalized}USDT`);
}

/** Для уведомлений об ошибке после парса — показывать пару из `SignalDto`, если есть, иначе эвристика по тексту. */
export function tokenHintForSignalFailure(text: string, pair?: string | null): string {
  const p = String(pair ?? '').trim().toUpperCase();
  if (p.length > 0) {
    return p;
  }
  return extractTokenHint(text);
}
