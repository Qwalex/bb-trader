import type { CabinetListItem } from './cabinet.types';

export type CloneCabinetResult = {
  item: CabinetListItem;
  /** Ключи настроек, не скопированные (уникальность Bybit/Telegram token). */
  skippedSettingKeys: string[];
};
