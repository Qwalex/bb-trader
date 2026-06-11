import type { DynamicModule, Type } from '@nestjs/common';

import {
  isApiProcessRole,
  isDedicatedApiProcessRole,
  isWorkerBybitProcessRole,
  isWorkerUserbotProcessRole,
} from '../config/process-role.util';
import { InternalApiModule } from '../internal/internal-api.module';
import { AppLogModule } from '../modules/app-log/app-log.module';
import { AuthModule } from '../modules/auth/auth.module';
import { BybitModule } from '../modules/bybit/bybit.module';
import { BybitSpotModule } from '../modules/bybit-spot/bybit-spot.module';
import { CabinetModule } from '../modules/cabinet/cabinet.module';
import { DiagnosticsModule } from '../modules/diagnostics/diagnostics.module';
import { OrdersModule } from '../modules/orders/orders.module';
import { SettingsModule } from '../modules/settings/settings.module';
import { TelegramModule } from '../modules/telegram';
import { TelegramUserbotModule } from '../modules/telegram-userbot/telegram-userbot.module';
import { TranscriptModule } from '../modules/transcript/transcript.module';
import { WorkerQueueModule } from '../modules/worker-queue/worker-queue.module';
import { VkModule } from '../modules/vk/vk.module';
import { PrismaModule } from '../prisma/prisma.module';

/** Модули Nest по `API_PROCESS_ROLE` (см. plan Worker split). */
export function buildRoleAppImports(): Array<Type | DynamicModule> {
  const imports: Array<Type | DynamicModule> = [
    PrismaModule,
    AuthModule,
    CabinetModule,
    AppLogModule,
    SettingsModule,
    InternalApiModule,
  ];

  if (isApiProcessRole()) {
    imports.push(
      DiagnosticsModule,
      OrdersModule,
      TranscriptModule,
      TelegramModule,
      BybitModule,
    );
  }

  if (isWorkerUserbotProcessRole()) {
    imports.push(TranscriptModule, TelegramUserbotModule, VkModule, OrdersModule);
  }

  if (isWorkerBybitProcessRole()) {
    imports.push(BybitModule, BybitSpotModule, WorkerQueueModule, OrdersModule);
  }

  if (isDedicatedApiProcessRole()) {
    // TelegramUserbotProxyModule подключается через InternalApiModule
  }

  return imports;
}
