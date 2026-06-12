import { forwardRef, type DynamicModule, type ForwardReference, type Type } from '@nestjs/common';

import { shouldRunUserbotMtproto } from '../../config/process-role.util';
import { AppLogModule } from '../app-log/app-log.module';
import { CabinetModule } from '../cabinet/cabinet.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramUserbotModule } from '../telegram-userbot/telegram-userbot.module';

/** Mirror/QPulse ingest — только там, где поднят MTProto userbot. */
export function buildQpulseSyncModuleImports(): Array<Type | DynamicModule | ForwardReference> {
  const imports: Array<Type | DynamicModule | ForwardReference> = [
    SettingsModule,
    CabinetModule,
    AppLogModule,
  ];
  if (shouldRunUserbotMtproto()) {
    imports.push(forwardRef(() => TelegramUserbotModule));
  }
  return imports;
}
