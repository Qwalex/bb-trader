import type { Locale } from './constants';
import { createTranslator } from './translate.util';
import { getMessages } from './messages';
import { EXTRA_LABELS, LABEL_BY_KEY } from '../../app/settings/settings-page.constants';

/** Setting label: i18n key settingsKeys.{KEY} or fallback to Russian constants. */
export function resolveSettingLabel(key: string, locale: Locale): string {
  const messages = getMessages(locale);
  const t = createTranslator(messages);
  const i18nKey = `settingsKeys.${key}`;
  const translated = t(i18nKey);
  if (translated !== i18nKey) {
    return translated;
  }
  return EXTRA_LABELS[key] ?? LABEL_BY_KEY[key] ?? key;
}

export function resolveSettingsSectionTitle(sectionId: string, locale: Locale): string {
  const messages = getMessages(locale);
  const t = createTranslator(messages);
  const i18nKey = `settings.sections.${sectionId}`;
  const translated = t(i18nKey);
  if (translated !== i18nKey) {
    return translated;
  }
  return sectionId;
}
