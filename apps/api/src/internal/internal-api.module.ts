import { forwardRef, Global, Module } from '@nestjs/common';

import {
  isApiProcessRole,
  isDedicatedApiProcessRole,
  isWorkerBybitProcessRole,
  isWorkerUserbotProcessRole,
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

const controllers = [
  ...(isApiProcessRole() ? [InternalTelegramController] : []),
  ...(isWorkerUserbotProcessRole() ? [InternalIngestController] : []),
  ...(isWorkerBybitProcessRole() ? [BybitInternalController] : []),
];

@Global()
@Module({
  imports: [
    CabinetModule,
    ...(isDedicatedApiProcessRole() ? [TelegramUserbotProxyModule] : []),
    ...(isApiProcessRole() ? [forwardRef(() => TelegramModule)] : []),
    ...(isWorkerUserbotProcessRole()
      ? [forwardRef(() => TelegramUserbotModule)]
      : []),
    ...(isWorkerBybitProcessRole()
      ? [forwardRef(() => BybitModule), forwardRef(() => BybitSpotModule)]
      : []),
  ],
  controllers,
  providers: [InternalServiceGuard, ApiInternalClientService, UserbotInternalProxyService],
  exports: [InternalServiceGuard, ApiInternalClientService, UserbotInternalProxyService],
})
export class InternalApiModule {}
