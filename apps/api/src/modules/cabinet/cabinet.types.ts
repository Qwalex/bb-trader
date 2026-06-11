export type CabinetPurpose = 'trading' | 'content';

export type CabinetListItem = {
  id: string;
  slug: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  purpose: CabinetPurpose;
};
