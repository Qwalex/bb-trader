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
