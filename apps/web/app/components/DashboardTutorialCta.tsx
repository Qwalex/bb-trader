import Link from 'next/link';

import { withCabinetPageHref } from '../../lib/cabinet-page-href.util';
import { getServerI18n } from '../../lib/i18n/server';

import styles from './dashboard-tutorial-cta.module.css';

type DashboardTutorialCtaProps = {
  cabinetId?: string | null;
};

export async function DashboardTutorialCta({ cabinetId }: DashboardTutorialCtaProps) {
  const { t } = await getServerI18n();
  const href = withCabinetPageHref('/tutorial', cabinetId?.trim() || undefined);

  return (
    <section className={styles.wrap} aria-label={t('tutorial.title')}>
      <Link href={href} className={styles.cta}>
        <span className={styles.ctaLabel}>{t('tutorial.ctaDashboard')}</span>
        <span className={styles.ctaHint}>{t('tutorial.ctaHint')}</span>
      </Link>
    </section>
  );
}
