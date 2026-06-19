import type { NavMenuItemConfig } from '@repo/shared';
import type { Translator } from './translate.util';

export function navItemLabel(t: Translator, item: NavMenuItemConfig): string {
  const key = `nav.${item.id}`;
  const translated = t(key);
  return translated === key ? item.label : translated;
}
