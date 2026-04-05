export type NavItemId =
  | 'dashboard'
  | 'trades'
  | 'logs'
  | 'ai'
  | 'diagnostics'
  | 'telegram-userbot'
  | 'my-group'
  | 'filters'
  | 'workspaces'
  | 'settings';

export type NavItem = {
  id: NavItemId;
  href: string;
  label: string;
  /** Только для appRole=admin (см. UserProfile в API). */
  adminOnly?: boolean;
};

/** Порядок — как в шапке (слева направо). */
export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', href: '/', label: 'Дашборд' },
  { id: 'trades', href: '/trades', label: 'Сделки' },
  { id: 'logs', href: '/logs', label: 'Логи' },
  { id: 'ai', href: '/ai', label: 'AI' },
  { id: 'diagnostics', href: '/diagnostics', label: 'Диагностика', adminOnly: true },
  { id: 'telegram-userbot', href: '/telegram-userbot', label: 'Userbot', adminOnly: true },
  { id: 'my-group', href: '/my-group', label: 'Моя группа' },
  { id: 'filters', href: '/filters', label: 'Фильтры', adminOnly: true },
  { id: 'workspaces', href: '/workspaces', label: 'Кабинеты' },
  { id: 'settings', href: '/settings', label: 'Настройки' },
];

export function navItemsVisibleForUser(isAppAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAppAdmin);
}
