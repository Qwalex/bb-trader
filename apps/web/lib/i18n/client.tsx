'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useTransition,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

import { withAppBasePath } from '../base-path';
import { createTranslator, type Translator } from './translate.util';
import { getMessages } from './messages';
import { LOCALE_LABELS, type Locale } from './constants';

type I18nContextValue = {
  locale: Locale;
  t: Translator;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(() => {
    const messages = getMessages(locale);
    return {
      locale,
      t: createTranslator(messages),
    };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return ctx;
}

export function LanguageSwitcher({ className }: { className?: string }) {
  const { locale } = useI18n();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const setLocale = useCallback(
    (next: Locale) => {
      if (next === locale) return;
      startTransition(async () => {
        await fetch(withAppBasePath('/api/locale'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale: next }),
        });
        router.refresh();
      });
    },
    [locale, router],
  );

  return (
    <label className={className ?? 'langSwitcher'}>
      <span className="langSwitcherLabel">Lang</span>
      <select
        className="langSwitcherSelect"
        value={locale}
        disabled={pending}
        aria-label="Language"
        onChange={(e) => setLocale(e.target.value as Locale)}
      >
        {(Object.keys(LOCALE_LABELS) as Locale[]).map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </label>
  );
}
