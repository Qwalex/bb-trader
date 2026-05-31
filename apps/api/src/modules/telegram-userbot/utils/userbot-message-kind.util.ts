import type { MessageKind, UserbotFilterKind } from '../telegram-userbot.types';

export const USERBOT_CLASSIFIER_KINDS = [
  'signal',
  'close',
  'reentry',
  'result',
  'ad',
  'analysis',
  'promo',
  'content',
  'other',
] as const satisfies readonly MessageKind[];

export const USERBOT_FILTER_KINDS = [
  ...USERBOT_CLASSIFIER_KINDS.filter((k) => k !== 'other'),
  'ignore',
] as const satisfies readonly UserbotFilterKind[];

export type UserbotClassifierKind = (typeof USERBOT_CLASSIFIER_KINDS)[number];
export type UserbotFilterKindValue = (typeof USERBOT_FILTER_KINDS)[number];

export function isUserbotClassifierKind(value: unknown): value is UserbotClassifierKind {
  return (
    typeof value === 'string' &&
    (USERBOT_CLASSIFIER_KINDS as readonly string[]).includes(value)
  );
}

export function isUserbotFilterKind(value: unknown): value is UserbotFilterKindValue {
  return typeof value === 'string' && (USERBOT_FILTER_KINDS as readonly string[]).includes(value);
}

/** Контент без торгового действия — не парсим и не ждём правку. */
export function isNonTradingContentKind(kind: MessageKind): boolean {
  return kind === 'ad' || kind === 'analysis' || kind === 'promo' || kind === 'content' || kind === 'other';
}
