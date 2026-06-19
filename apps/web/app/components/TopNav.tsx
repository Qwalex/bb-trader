'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { NAV_MENU_ITEMS, normalizeCabinetPurpose, type CabinetPurpose } from '@repo/shared';

import { withCabinetPageHref } from '../../lib/cabinet-page-href.util';
import { filterNavMenuItems, resolveNavHiddenIds } from '../../lib/cabinet-nav.util';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';
import { fetchApiResponse } from '../../lib/api';
import { LanguageSwitcher, useI18n } from '../../lib/i18n/client';
import { navItemLabel } from '../../lib/i18n/nav.util';
import { CabinetSwitcher } from './CabinetSwitcher';

type TopNavProps = {
  isAdmin: boolean;
  cabinetId: string;
  hiddenMenuIds: string[];
};

type TopNavBodyProps = TopNavProps & {
  /** Меняется при смене query (в т.ч. `cabinetId`) — пересчёт ссылок и селекта */
  cabinetSyncKey: string;
};

function TopNavBody({
  isAdmin,
  cabinetId: serverCabinetId,
  hiddenMenuIds,
  cabinetSyncKey,
}: TopNavBodyProps) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const [linkCabinetId, setLinkCabinetId] = useState(serverCabinetId);
  const [cabinetPurpose, setCabinetPurpose] = useState<CabinetPurpose>('trading');

  useEffect(() => {
    setLinkCabinetId(readActiveCabinetIdClient() || serverCabinetId);
  }, [serverCabinetId, cabinetSyncKey]);

  useEffect(() => {
    const cabinetId = linkCabinetId?.trim();
    if (!cabinetId) {
      setCabinetPurpose('trading');
      return;
    }
    void (async () => {
      try {
        const res = await fetchApiResponse('/cabinets');
        if (!res.ok) return;
        const json = (await res.json()) as {
          items?: Array<{ id: string; purpose?: string }>;
        };
        const row = (json.items ?? []).find((c) => c.id === cabinetId);
        setCabinetPurpose(normalizeCabinetPurpose(row?.purpose));
      } catch {
        setCabinetPurpose('trading');
      }
    })();
  }, [linkCabinetId, cabinetSyncKey]);

  const hiddenSet = useMemo(
    () => resolveNavHiddenIds(hiddenMenuIds, cabinetPurpose),
    [hiddenMenuIds, cabinetPurpose],
  );

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const root = menuRef.current;
      if (!root) return;
      const target = event.target as Node | null;
      if (target && !root.contains(target)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const withCabinet = (path: string): string =>
    withCabinetPageHref(path, linkCabinetId);

  const visibleItems = useMemo(
    () => filterNavMenuItems({ isAdmin, hiddenSet, cabinetPurpose }),
    [isAdmin, hiddenSet, cabinetPurpose],
  );
  const hiddenItems = useMemo(
    () =>
      NAV_MENU_ITEMS.filter((item) => {
        if (
          item.adminOnly &&
          !isAdmin &&
          !(cabinetPurpose === 'content' && item.contentCabinetPreferred)
        ) {
          return false;
        }
        return hiddenSet.has(item.id);
      }),
    [isAdmin, hiddenSet, cabinetPurpose],
  );
  const allItems = useMemo(
    () => filterNavMenuItems({ isAdmin: true, hiddenSet: new Set(), cabinetPurpose }),
    [cabinetPurpose],
  );

  return (
    <header className="nav">
      <Link href={withCabinetPageHref('/', linkCabinetId)} className="brand">
        QSignals
      </Link>
      <nav className="navLinks">
        {visibleItems.map((item) => (
          <Link
            key={item.id}
            href={item.cabinetAware ? withCabinet(item.href) : item.href}
          >
            {navItemLabel(t, item)}
          </Link>
        ))}
        <LanguageSwitcher />
      </nav>
      <details
        className="navBurger"
        ref={menuRef}
        open={menuOpen}
        onToggle={(e) => setMenuOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="navBurgerBtn" aria-label={t('nav.openMenu')}>
          ☰
        </summary>
        <div className="navBurgerMenu card">
          <div className="navBurgerSection">
            <span className="navBurgerCaption">{t('nav.activeCabinet')}</span>
            <CabinetSwitcher compact cabinetSyncKey={cabinetSyncKey} />
          </div>
          <div className="navBurgerLinks navBurgerLinksDesktop">
            {hiddenItems.map((item) => (
              <Link
                key={item.id}
                href={item.cabinetAware ? withCabinet(item.href) : item.href}
                onClick={() => setMenuOpen(false)}
              >
                {navItemLabel(t, item)}
              </Link>
            ))}
          </div>
          <div className="navBurgerLinks navBurgerLinksMobile">
            {allItems.map((item) => (
              <Link
                key={item.id}
                href={item.cabinetAware ? withCabinet(item.href) : item.href}
                onClick={() => setMenuOpen(false)}
              >
                {navItemLabel(t, item)}
              </Link>
            ))}
          </div>
        </div>
      </details>
    </header>
  );
}

function TopNavCabinetSynced(props: TopNavProps) {
  const searchParams = useSearchParams();
  const cabinetSyncKey = searchParams.toString();
  return <TopNavBody {...props} cabinetSyncKey={cabinetSyncKey} />;
}

export function TopNav(props: TopNavProps) {
  return (
    <Suspense fallback={<TopNavBody {...props} cabinetSyncKey="" />}>
      <TopNavCabinetSynced {...props} />
    </Suspense>
  );
}
