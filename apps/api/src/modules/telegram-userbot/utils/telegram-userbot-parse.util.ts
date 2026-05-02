export function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

export function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return undefined;
}

export function readNumericString(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string') {
    const t = value.trim();
    if (/^-?\d+$/.test(t)) {
      return t;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    const maybeObj = value as Record<string, unknown>;
    const nestedValue = maybeObj.value ?? maybeObj.low;
    if (nestedValue !== undefined) {
      const nested = readNumericString(nestedValue);
      if (nested) {
        return nested;
      }
    }
    const asString = String(value).trim();
    if (/^-?\d+$/.test(asString)) {
      return asString;
    }
  }
  return undefined;
}

export function extractReplyToMessageId(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return (
      readNumericString(obj.replyToMsgId ?? obj.reply_to_msg_id) ??
      readNumericString(obj.replyToTopId ?? obj.reply_to_top_id) ??
      readNumericString(obj.msgId ?? obj.msg_id) ??
      readNumericString(obj.id)
    );
  }
  return readNumericString(value);
}

export function extractSignalExternalId(text: unknown): string | undefined {
  const raw = typeof text === 'string' ? text : '';
  if (!raw) {
    return undefined;
  }
  const normalized = raw.replace(/\u00a0/g, ' ');
  const match = normalized.match(
    /(?:^|[^\p{L}\p{N}_])signal\s*id\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,127})/iu,
  );
  return match?.[1]?.trim();
}

export function readBooleanish(value: unknown): boolean {
  return value === true || value === 1 || value === 'true';
}

export function extractMessageDate(value: unknown): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const dt = new Date(ms);
    return Number.isFinite(dt.getTime()) ? dt : undefined;
  }
  if (typeof value === 'bigint') {
    const n = Number(value);
    if (Number.isFinite(n)) {
      return extractMessageDate(n);
    }
    return undefined;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    if (/^\d+$/.test(value.trim())) {
      return extractMessageDate(Number(value.trim()));
    }
    const dt = new Date(value);
    return Number.isFinite(dt.getTime()) ? dt : undefined;
  }
  return undefined;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isToday(d: Date): boolean {
  return d.getTime() >= startOfToday().getTime();
}

export function toChannelChatId(raw: string): string {
  const digits = raw.replace(/^-100/, '').replace(/^-/, '');
  return `-100${digits}`;
}

export function toLegacyGroupChatId(raw: string): string {
  const digits = raw.replace(/^-/, '');
  return `-${digits}`;
}

export function resolveChatIdFromDialog(dialog: Record<string, unknown>): string | undefined {
  const entity = (dialog.entity ?? {}) as Record<string, unknown>;
  const className = readString(entity.className)?.toLowerCase();
  const fromInput = (dialog.inputEntity ?? {}) as Record<string, unknown>;

  const channelId =
    readNumericString(fromInput.channelId ?? fromInput.channel_id) ??
    readNumericString(entity.id);
  if (
    channelId &&
    (readBooleanish(dialog.isChannel) || className === 'channel')
  ) {
    return toChannelChatId(channelId);
  }

  const chatId =
    readNumericString(fromInput.chatId ?? fromInput.chat_id) ??
    readNumericString(entity.id);
  if (chatId && className === 'chat') {
    return toLegacyGroupChatId(chatId);
  }

  const genericId =
    readNumericString(dialog.id) ??
    readNumericString(entity.id) ??
    readNumericString(fromInput.channelId ?? fromInput.channel_id) ??
    readNumericString(fromInput.chatId ?? fromInput.chat_id);
  if (!genericId) {
    return undefined;
  }
  if (genericId.startsWith('-100') || genericId.startsWith('-')) {
    return genericId;
  }
  return toChannelChatId(genericId);
}

export function resolveChatIdFromEvent(
  event: Record<string, unknown>,
  msg: Record<string, unknown> | undefined,
): string | undefined {
  const fromEvent = readNumericString(event.chatId ?? event.chat_id);
  if (fromEvent) {
    return fromEvent;
  }
  const peerId = (msg?.peerId ?? msg?.peer) as Record<string, unknown> | undefined;
  const channelId = readNumericString(
    peerId?.channelId ?? peerId?.channel_id,
  );
  if (channelId != null) {
    return toChannelChatId(channelId);
  }
  const chatId = readNumericString(peerId?.chatId ?? peerId?.chat_id);
  if (chatId != null) {
    return toLegacyGroupChatId(chatId);
  }
  const userId = readNumericString(peerId?.userId ?? peerId?.user_id);
  if (userId != null) {
    return userId;
  }
  return undefined;
}

export function limitTrace(value: string, max = 7000): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)} ...[truncated ${value.length - max} chars]`;
}
