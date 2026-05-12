'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { NAV_MENU_ITEMS } from '@repo/shared';

import { withCabinetPageHref } from '../../lib/cabinet-page-href.util';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';
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
  const hiddenSet = useMemo(() => new Set(hiddenMenuIds), [hiddenMenuIds]);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const [linkCabinetId, setLinkCabinetId] = useState(serverCabinetId);

  useEffect(() => {
    setLinkCabinetId(readActiveCabinetIdClient() || serverCabinetId);
  }, [serverCabinetId, cabinetSyncKey]);

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

  const visibleItems = NAV_MENU_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    return !hiddenSet.has(item.id);
  });
  const hiddenItems = NAV_MENU_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    return hiddenSet.has(item.id);
  });
  const allItems = NAV_MENU_ITEMS.filter((item) => !(item.adminOnly && !isAdmin));

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
            {item.label}
          </Link>
        ))}
      </nav>
      <details
        className="navBurger"
        ref={menuRef}
        open={menuOpen}
        onToggle={(e) => setMenuOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="navBurgerBtn" aria-label="Открыть меню">
          ☰
        </summary>
        <div className="navBurgerMenu card">
          <div className="navBurgerSection">
            <span className="navBurgerCaption">Активный кабинет</span>
            <CabinetSwitcher compact cabinetSyncKey={cabinetSyncKey} />
          </div>
          <div className="navBurgerLinks navBurgerLinksDesktop">
            {hiddenItems.map((item) => (
              <Link
                key={item.id}
                href={item.cabinetAware ? withCabinet(item.href) : item.href}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
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
                {item.label}
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
