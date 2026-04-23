import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VkModule } from '../vk/vk.module';
import { WorkerQueueModule } from '../worker-queue/worker-queue.module';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { BybitController } from './bybit.controller';
import { BybitPollService } from './bybit-poll.service';
import { BybitService } from './bybit.service';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => TelegramModule),
    forwardRef(() => VkModule),
    forwardRef(() => WorkerQueueModule),
    AppLogModule,
  ],
  controllers: [BybitController],
  providers: [BybitService, BybitPollService, BalanceSnapshotService],
  exports: [BybitService, BalanceSnapshotService],
})
export class BybitModule {}
