import { forwardRef, type DynamicModule, type ForwardReference, type Type } from '@nestjs/common';

import {
  isApiProcessRole,
  isWorkerBybitProcessRole,
  shouldRunUserbotMtproto,
} from '../../config/process-role.util';
import { BybitModule } from '../bybit/bybit.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram';
import { TelegramUserbotModule } from '../telegram-userbot/telegram-userbot.module';
import { UserbotSignalHashModule } from '../telegram-userbot/userbot-signal-hash.module';
import { QpulseSyncModule } from '../qpulse-sync/qpulse-sync.module';

/** Импорты OrdersModule без MTProto userbot на dedicated Api / Worker-Bybit. */
export function buildOrdersModuleImports(): Array<Type | DynamicModule | ForwardReference> {
  const imports: Array<Type | DynamicModule | ForwardReference> = [
    SettingsModule,
    UserbotSignalHashModule,
    forwardRef(() => QpulseSyncModule),
  ];

  if (isApiProcessRole() || isWorkerBybitProcessRole()) {
    imports.push(forwardRef(() => TelegramModule));
  }

  if (isApiProcessRole() || isWorkerBybitProcessRole()) {
    imports.push(forwardRef(() => BybitModule));
  }

  if (shouldRunUserbotMtproto()) {
    imports.push(forwardRef(() => TelegramUserbotModule));
  }

  return imports;
}
