import { forwardRef, type DynamicModule, type ForwardReference, type Type } from '@nestjs/common';

import {
  isApiProcessRole,
  isWorkerBybitProcessRole,
  shouldRunUserbotMtproto,
} from '../../config/process-role.util';
import { AppLogModule } from '../app-log/app-log.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram';
import { VkModule } from '../vk/vk.module';
import { WorkerQueueModule } from '../worker-queue/worker-queue.module';
import { BybitSpotModule } from '../bybit-spot/bybit-spot.module';
import { BalanceAlertController } from './balance-alert/balance-alert.controller';
import { BybitController } from './bybit.controller';

/** HTTP Bybit и очередь — только Api (proxy) и Worker-Bybit. */
export function buildBybitModuleControllers(): Array<Type> {
  if (isApiProcessRole() || isWorkerBybitProcessRole()) {
    return [BybitController, BalanceAlertController];
  }
  return [];
}

export function buildBybitModuleImports(): Array<Type | DynamicModule | ForwardReference> {
  const imports: Array<Type | DynamicModule | ForwardReference> = [
    PrismaModule,
    SettingsModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => TelegramModule),
    forwardRef(() => BybitSpotModule),
    AppLogModule,
  ];

  // DI для notify/poll; consumer gated через shouldRunWorkerQueue().
  imports.push(forwardRef(() => WorkerQueueModule));

  if (isApiProcessRole() || isWorkerBybitProcessRole() || shouldRunUserbotMtproto()) {
    imports.push(forwardRef(() => VkModule));
  }

  return imports;
}
