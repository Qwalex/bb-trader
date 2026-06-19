import Link from 'next/link';

import { withCabinetPageHref } from '../../lib/cabinet-page-href.util';
import { getServerI18n } from '../../lib/i18n/server';

import styles from './tutorial-page.module.css';

const VIDEO_SLOT_COUNT = 3;

export default async function TutorialPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { t, messages } = await getServerI18n();
  const sp = await searchParams;
  const cabinetId =
    typeof sp.cabinetId === 'string' ? sp.cabinetId.trim() : '';
  const settingsHref = withCabinetPageHref('/settings?scope=cabinet', cabinetId);
  const userbotHref = withCabinetPageHref('/telegram-userbot', cabinetId);
  const filtersHref = withCabinetPageHref('/filters', cabinetId);

  const steps = [
    {
      title: t('tutorial.step1Title'),
      body: t('tutorial.step1Body'),
      where: t('tutorial.step1Where'),
      settings: t('tutorial.step1Settings'),
      links: [{ href: settingsHref, label: t('common.goToSettings') }],
    },
    {
      title: t('tutorial.step2Title'),
      body: t('tutorial.step2Body'),
      where: t('tutorial.step2Where'),
      settings: t('tutorial.step2Settings'),
      links: [{ href: settingsHref, label: t('common.goToSettings') }],
    },
    {
      title: t('tutorial.step3Title'),
      body: t('tutorial.step3Body'),
      where: t('tutorial.step3Where'),
      settings: t('tutorial.step3Settings'),
      links: [{ href: settingsHref, label: t('common.goToSettings') }],
    },
    {
      title: t('tutorial.step4Title'),
      body: t('tutorial.step4Body'),
      where: t('tutorial.step4Where'),
      settings: t('tutorial.step4Settings'),
      links: [
        { href: settingsHref, label: t('common.goToSettings') },
        { href: userbotHref, label: t('common.goToUserbot') },
      ],
    },
    {
      title: t('tutorial.step5Title'),
      body: t('tutorial.step5Body'),
      where: t('tutorial.step5Where'),
      settings: t('tutorial.step5Settings'),
      links: [
        { href: userbotHref, label: t('common.goToUserbot') },
        { href: filtersHref, label: t('common.goToFilters') },
      ],
    },
    {
      title: t('tutorial.step6Title'),
      body: t('tutorial.step6Body'),
      where: '',
      settings: t('tutorial.step6Settings'),
      links: [{ href: settingsHref, label: t('common.goToSettings') }],
    },
    {
      title: t('tutorial.step7Title'),
      body: t('tutorial.step7Body'),
      where: '',
      settings: t('tutorial.step7Settings'),
      links: [{ href: settingsHref, label: t('common.goToSettings') }],
    },
    {
      title: t('tutorial.step8Title'),
      body: t('tutorial.step8Body'),
      where: t('tutorial.step8Note'),
      settings: '',
      links: [{ href: settingsHref, label: t('common.goToSettings') }],
    },
    {
      title: t('tutorial.step9Title'),
      body: t('tutorial.step9Body'),
      where: '',
      settings: '',
      links: [
        { href: withCabinetPageHref('/', cabinetId), label: t('nav.dashboard') },
        { href: withCabinetPageHref('/trades', cabinetId), label: t('nav.trades') },
      ],
    },
  ];

  const checklistRaw = (messages.tutorial as { checklist?: string[] } | undefined)?.checklist;
  const checklist = Array.isArray(checklistRaw) ? checklistRaw : [];

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <h1 className="pageTitle">{t('tutorial.title')}</h1>
        <p className={styles.subtitle}>{t('tutorial.subtitle')}</p>
      </header>

      <section className={`card ${styles.overview}`}>
        <h2 className={styles.sectionTitle}>{t('tutorial.overviewTitle')}</h2>
        <p className={styles.bodyText}>{t('tutorial.overviewBody')}</p>
      </section>

      <section className={styles.videoSection}>
        <h2 className={styles.sectionTitle}>{t('tutorial.videoSection')}</h2>
        <div className={styles.videoGrid}>
          {Array.from({ length: VIDEO_SLOT_COUNT }, (_, index) => (
            <div key={index} className={styles.videoSlot}>
              <div className={styles.videoPlaceholder} aria-hidden>
                ▶
              </div>
              <p className={styles.videoCaption}>{t('common.videoPlaceholder')}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.stepsSection}>
        <h2 className={styles.sectionTitle}>{t('tutorial.stepsTitle')}</h2>
        <ol className={styles.stepsList}>
          {steps.map((step) => (
            <li key={step.title} className={`card ${styles.stepCard}`}>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.bodyText}>{step.body}</p>
              {step.where ? <p className={styles.meta}>{step.where}</p> : null}
              {step.settings ? <p className={styles.settingsHint}>{step.settings}</p> : null}
              {step.links.length > 0 ? (
                <div className={styles.stepLinks}>
                  {step.links.map((link) => (
                    <Link key={link.href + link.label} href={link.href} className={styles.stepLink}>
                      {link.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className={`card ${styles.checklist}`}>
        <h2 className={styles.sectionTitle}>{t('tutorial.checklistTitle')}</h2>
        <ul className={styles.checklistList}>
          {checklist.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
