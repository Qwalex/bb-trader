import { forwardRef, Global, Module } from '@nestjs/common';

import {
  isDedicatedApiProcessRole,
  isDedicatedWorkerBybitProcessRole,
  isDedicatedWorkerUserbotProcessRole,
} from '../config/process-role.util';
import { CabinetModule } from '../modules/cabinet/cabinet.module';
import { BybitModule } from '../modules/bybit/bybit.module';
import { BybitSpotModule } from '../modules/bybit-spot/bybit-spot.module';
import { TelegramModule } from '../modules/telegram';
import { TelegramUserbotModule } from '../modules/telegram-userbot/telegram-userbot.module';
import { ApiInternalClientService } from './api-internal-client.service';
import { BybitInternalController } from './bybit-internal.controller';
import { InternalIngestController } from './internal-ingest.controller';
import { InternalServiceGuard } from './internal-service.guard';
import { InternalTelegramController } from './internal-telegram.controller';
import { TelegramUserbotProxyModule } from './telegram-userbot-proxy.module';
import { UserbotInternalProxyService } from './userbot-internal-proxy.service';

/** Internal HTTP только на dedicated-ролях; при `all` маршруты не регистрируются. */
const controllers = [
  ...(isDedicatedApiProcessRole() ? [InternalTelegramController] : []),
  ...(isDedicatedWorkerUserbotProcessRole() ? [InternalIngestController] : []),
  ...(isDedicatedWorkerBybitProcessRole() ? [BybitInternalController] : []),
];

@Global()
@Module({
  imports: [
    CabinetModule,
    ...(isDedicatedApiProcessRole() ? [TelegramUserbotProxyModule] : []),
    ...(isDedicatedApiProcessRole() ? [forwardRef(() => TelegramModule)] : []),
    ...(isDedicatedWorkerUserbotProcessRole()
      ? [forwardRef(() => TelegramUserbotModule)]
      : []),
    ...(isDedicatedWorkerBybitProcessRole()
      ? [forwardRef(() => BybitModule), forwardRef(() => BybitSpotModule)]
      : []),
  ],
  controllers,
  providers: [InternalServiceGuard, ApiInternalClientService, UserbotInternalProxyService],
  exports: [InternalServiceGuard, ApiInternalClientService, UserbotInternalProxyService],
})
export class InternalApiModule {}
