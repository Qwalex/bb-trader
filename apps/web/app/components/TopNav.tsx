'use client';

import Link from 'next/link';
import { useMemo } from 'react';

import { NAV_MENU_ITEMS } from '@repo/shared';

import { CabinetSwitcher } from './CabinetSwitcher';

type TopNavProps = {
  isAdmin: boolean;
  cabinetId: string;
  hiddenMenuIds: string[];
};

export function TopNav(props: TopNavProps) {
  const { isAdmin, cabinetId, hiddenMenuIds } = props;
  const hiddenSet = useMemo(() => new Set(hiddenMenuIds), [hiddenMenuIds]);

  const withCabinet = (path: string): string => {
    if (!cabinetId) return path;
    const hasQuery = path.includes('?');
    return `${path}${hasQuery ? '&' : '?'}cabinetId=${encodeURIComponent(cabinetId)}`;
  };

  const visibleItems = NAV_MENU_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    return !hiddenSet.has(item.id);
  });
  const hiddenItems = NAV_MENU_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    return hiddenSet.has(item.id);
  });

  return (
    <header className="nav">
      <strong className="brand">SignalsBot</strong>
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
      <details className="navBurger">
        <summary className="navBurgerBtn" aria-label="Открыть меню">
          ☰
        </summary>
        <div className="navBurgerMenu card">
          <div className="navBurgerSection">
            <span className="navBurgerCaption">Активный кабинет</span>
            <CabinetSwitcher compact />
          </div>
          <div className="navBurgerLinks">
            {hiddenItems.map((item) => (
              <Link
                key={item.id}
                href={item.cabinetAware ? withCabinet(item.href) : item.href}
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

