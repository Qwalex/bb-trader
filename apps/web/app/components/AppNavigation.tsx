'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { getApiBase } from '../../lib/api';
import { withBasePath } from '../../lib/auth';
import { navItemsVisibleForUser, type NavItem } from '../../lib/nav-items';

type UiPayload = {
  navMenuInBurger?: string[];
  appRole?: string;
};

export function AppNavigation() {
  const [inBurger, setInBurger] = useState<Set<string>>(() => new Set());
  const [isAppAdmin, setIsAppAdmin] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${getApiBase()}/settings/ui`);
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as UiPayload;
        const ids = Array.isArray(data.navMenuInBurger) ? data.navMenuInBurger : [];
        setInBurger(new Set(ids.map((x) => String(x).trim()).filter(Boolean)));
        setIsAppAdmin(data.appRole === 'admin');
      } catch {
        // оставляем пустой набор → все пункты в полоске
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const el = panelRef.current;
      if (el && !el.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const visibleItems = navItemsVisibleForUser(isAppAdmin);
  const primary: NavItem[] = [];
  const secondary: NavItem[] = [];
  for (const item of visibleItems) {
    if (inBurger.has(item.id)) secondary.push(item);
    else primary.push(item);
  }

  return (
    <nav className="navApp" aria-label="Основная навигация">
      <div className="navAppStrip">
        <WorkspaceSwitcher />
        {primary.map((item) => (
          <Link key={item.id} href={item.href} className="navAppLink">
            {item.label}
          </Link>
        ))}
        {secondary.length > 0 ? (
          <div className="navBurgerWrap" ref={panelRef}>
            <button
              type="button"
              className="navBurgerBtn"
              aria-expanded={menuOpen}
              aria-controls="nav-burger-panel"
              aria-label="Открыть дополнительные разделы"
              onClick={() => setMenuOpen((o) => !o)}
            >
              ☰
            </button>
            {menuOpen ? (
              <div id="nav-burger-panel" className="navBurgerPanel" role="menu">
                {secondary.map((item) => (
                  <Link
                    key={item.id}
                    role="menuitem"
                    href={item.href}
                    className="navBurgerLink"
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <form action={withBasePath('/auth/logout')} method="post" className="navLogoutForm">
          <button type="submit" className="navLogoutBtn">
            Выйти
          </button>
        </form>
      </div>
    </nav>
  );
}
