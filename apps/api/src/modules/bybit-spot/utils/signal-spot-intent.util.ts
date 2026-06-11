import type { SignalDto } from '@repo/shared';

const SPOT_INTENT_PATTERNS: RegExp[] = [
  /\bspot\b/i,
  /\bспот\b/i,
  /(?:type|market|trade\s*type)\s*[:#=\-]?\s*spot\b/i,
  /#spot\b/i,
  /\bspot\s*(?:market|trade|buy|long)\b/i,
];

/** Сообщение явно помечает сделку как спотовую (type spot, #spot, «спот» и т.п.). */
export function detectSpotIntentInMessage(raw: string | null | undefined): boolean {
  const text = String(raw ?? '').trim();
  if (!text) return false;
  return SPOT_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

/** QPulse: linear 1x с spot-intent → SPOT; реальный spot (marketType=spot) → не синхронизировать. */
export function resolveQpulseSpotPresentation(row: {
  marketType?: string | null;
  rawMessage?: string | null;
}): boolean {
  const marketType = String(row.marketType ?? 'linear').toLowerCase();
  if (marketType === 'spot') return false;
  return detectSpotIntentInMessage(row.rawMessage);
}

export function applySpotIntentLeverage(
  signal: SignalDto,
  rawMessage?: string | null,
): SignalDto {
  if (!detectSpotIntentInMessage(rawMessage)) return signal;
  return { ...signal, leverage: 1 };
}
