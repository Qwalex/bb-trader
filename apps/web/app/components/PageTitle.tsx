'use client';

import { useI18n } from '../../lib/i18n/client';

type PageTitleProps = {
  titleKey: string;
};

export function PageTitle({ titleKey }: PageTitleProps) {
  const { t } = useI18n();
  return <h1 className="pageTitle">{t(titleKey)}</h1>;
}
