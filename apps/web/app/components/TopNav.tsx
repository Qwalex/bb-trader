'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLElement | null>(null);

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
  const allItems = NAV_MENU_ITEMS.filter((item) => !(item.adminOnly && !isAdmin));

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
            <CabinetSwitcher compact />
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

