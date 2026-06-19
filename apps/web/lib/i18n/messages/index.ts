import type { Locale } from '../constants';
import { en } from './en';
import { ru } from './ru';

const MESSAGES: Record<Locale, Record<string, unknown>> = {
  en,
  ru,
};

export function getMessages(locale: Locale): Record<string, unknown> {
  return MESSAGES[locale];
}
