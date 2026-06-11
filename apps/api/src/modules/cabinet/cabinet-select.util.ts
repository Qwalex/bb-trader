import type { CabinetListItem } from './cabinet.types';

export const CABINET_LIST_SELECT = {
  id: true,
  slug: true,
  name: true,
  isDefault: true,
  isActive: true,
  purpose: true,
} as const;

export function mapCabinetListRow(row: {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  purpose?: string | null;
}): CabinetListItem {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    isDefault: row.isDefault,
    isActive: row.isActive,
    purpose: String(row.purpose ?? '').trim().toLowerCase() === 'content' ? 'content' : 'trading',
  };
}
