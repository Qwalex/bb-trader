import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VkModule } from '../vk/vk.module';
import { WorkerQueueModule } from '../worker-queue/worker-queue.module';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { BybitBalanceInstrumentService } from './bybit-balance-instrument.service';
import { BybitClientService } from './bybit-client.service';
import { BybitController } from './bybit.controller';
import { BybitExchangeCleanupService } from './bybit-exchange-cleanup.service';
import { BybitExposureService } from './bybit-exposure.service';
import { BybitLiveSnapshotService } from './bybit-live-snapshot.service';
import { BybitOrderExchangeQueryService } from './bybit-order-exchange-query.service';
import { BybitOrderLifecyclePollService } from './bybit-order-lifecycle-poll.service';
import { BybitNotifyService } from './bybit-notify.service';
import { BybitPlacementValidationService } from './bybit-placement-validation.service';
import { BybitPnlService } from './bybit-pnl.service';
import { BybitPollFinalizeService } from './bybit-poll-finalize.service';
import { BybitPollService } from './bybit-poll.service';
import { BybitPositionCloseService } from './bybit-position-close.service';
import { BybitRecalcService } from './bybit-recalc.service';
import { BybitSignalOverridesService } from './bybit-signal-overrides.service';
import { BybitSignalPlacementService } from './bybit-signal-placement.service';
import { BybitService } from './bybit.service';
import { BybitTpSlService } from './bybit-tpsl.service';

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
  providers: [
    BybitService,
    BybitClientService,
    BybitBalanceInstrumentService,
    BybitOrderExchangeQueryService,
    BybitPlacementValidationService,
    BybitSignalOverridesService,
    BybitLiveSnapshotService,
    BybitPollFinalizeService,
    BybitExchangeCleanupService,
    BybitExposureService,
    BybitTpSlService,
    BybitPnlService,
    BybitSignalPlacementService,
    BybitOrderLifecyclePollService,
    BybitNotifyService,
    BybitPositionCloseService,
    BybitRecalcService,
    BybitPollService,
    BalanceSnapshotService,
  ],
  exports: [BybitService, BalanceSnapshotService],
})
export class BybitModule {}
