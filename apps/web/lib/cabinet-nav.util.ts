import {
  NAV_MENU_ITEMS,
  normalizeCabinetPurpose,
  type CabinetPurpose,
} from '@repo/shared';

export function resolveNavHiddenIds(
  hiddenMenuIds: readonly string[],
  purpose: CabinetPurpose | null | undefined,
): Set<string> {
  const hidden = new Set(hiddenMenuIds);
  if (normalizeCabinetPurpose(purpose) !== 'content') {
    return hidden;
  }
  for (const item of NAV_MENU_ITEMS) {
    if (item.tradingOnly) {
      hidden.add(item.id);
    }
    if (item.contentCabinetPreferred) {
      hidden.delete(item.id);
    }
  }
  return hidden;
}

export function filterNavMenuItems(params: {
  isAdmin: boolean;
  hiddenSet: Set<string>;
  cabinetPurpose?: CabinetPurpose | null;
}): (typeof NAV_MENU_ITEMS)[number][] {
  const isContent = normalizeCabinetPurpose(params.cabinetPurpose) === 'content';
  return NAV_MENU_ITEMS.filter((item) => {
    if (item.adminOnly && !params.isAdmin && !(isContent && item.contentCabinetPreferred)) {
      return false;
    }
    return !params.hiddenSet.has(item.id);
  });
}
