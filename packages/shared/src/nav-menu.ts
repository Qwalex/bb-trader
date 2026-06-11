export type NavMenuItemConfig = {
  id: string;
  label: string;
  href: string;
  cabinetAware?: boolean;
  adminOnly?: boolean;
  defaultHidden?: boolean;
  /** Скрывать в информационном (content) кабинете */
  tradingOnly?: boolean;
  /** Показывать по умолчанию в content-кабинете (снимает defaultHidden для content) */
  contentCabinetPreferred?: boolean;
};

export const NAV_MENU_ITEMS: NavMenuItemConfig[] = [
  { id: 'dashboard', label: 'Дашборд', href: '/', cabinetAware: true, tradingOnly: true },
  {
    id: 'leverage-calculator',
    label: 'Кредит / доходность',
    href: '/leverage-calculator',
    defaultHidden: true,
    tradingOnly: true,
  },
  { id: 'trades', label: 'Сделки', href: '/trades', cabinetAware: true, tradingOnly: true },
  { id: 'ai', label: 'AI', href: '/ai', cabinetAware: true, defaultHidden: true },
  { id: 'diagnostics', label: 'Диагностика', href: '/diagnostics', cabinetAware: true, adminOnly: true, defaultHidden: true, tradingOnly: true },
  {
    id: 'logs',
    label: 'Логи',
    href: '/logs',
    cabinetAware: true,
    adminOnly: true,
    defaultHidden: true,
  },
  { id: 'telegram-userbot', label: 'Userbot', href: '/telegram-userbot', cabinetAware: true, defaultHidden: true, contentCabinetPreferred: true },
  { id: 'openrouter-spend', label: 'Расходы OpenRouter', href: '/openrouter-spend', cabinetAware: true, adminOnly: true, defaultHidden: true },
  { id: 'my-group', label: 'Моя группа', href: '/my-group', cabinetAware: true, adminOnly: true, defaultHidden: true, contentCabinetPreferred: true },
  { id: 'content-editor', label: 'Редактор контента', href: '/content-editor', cabinetAware: true, adminOnly: true, defaultHidden: true, contentCabinetPreferred: true },
  { id: 'filters', label: 'Фильтры', href: '/filters', cabinetAware: true, defaultHidden: true, contentCabinetPreferred: true },
  { id: 'settings-cabinet', label: 'Настройки кабинета', href: '/settings?scope=cabinet', cabinetAware: true },
  { id: 'settings-account', label: 'Настройки аккаунта', href: '/settings?scope=account', defaultHidden: true },
  { id: 'cabinets', label: 'Кабинеты', href: '/cabinets', defaultHidden: true },
];

export const NAV_MENU_HIDDEN_SETTING_KEY = 'NAV_HIDDEN_MENU_ITEMS';

