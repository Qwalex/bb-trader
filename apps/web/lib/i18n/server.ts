import { cookies } from 'next/headers';

import { createTranslator, type Translator } from './translate.util';
import { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale, type Locale } from './constants';
import { getMessages } from './messages';

export async function getServerLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  return normalizeLocale(cookieStore.get(LOCALE_COOKIE)?.value);
}

export async function getServerI18n(): Promise<{
  locale: Locale;
  t: Translator;
  messages: Record<string, unknown>;
}> {
  const locale = await getServerLocale();
  const messages = getMessages(locale);
  return {
    locale,
    messages,
    t: createTranslator(messages),
  };
}

export function getI18nForLocale(locale: Locale): {
  locale: Locale;
  t: Translator;
  messages: Record<string, unknown>;
} {
  const messages = getMessages(locale);
  return {
    locale,
    messages,
    t: createTranslator(messages),
  };
}

export { DEFAULT_LOCALE, LOCALE_COOKIE, normalizeLocale };
export type { Locale };
