import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram';
import { VkModule } from '../vk/vk.module';
import { WorkerQueueModule } from '../worker-queue/worker-queue.module';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { BybitController } from './bybit.controller';
import { BybitService } from './bybit.service';
import { BybitBalanceInstrumentService } from './instrument/bybit-balance-instrument.service';
import { BybitClientService } from './instrument/bybit-client.service';
import { BybitExposureService } from './exposure/bybit-exposure.service';
import { BybitLiveSnapshotService } from './exposure/bybit-live-snapshot.service';
import { BybitOrderExchangeQueryService } from './orders/bybit-order-exchange-query.service';
import { BybitOrderLifecyclePollService } from './orders/bybit-order-lifecycle-poll.service';
import { BybitPlacementValidationService } from './orders/bybit-placement-validation.service';
import { BybitSignalPlacementService } from './orders/bybit-signal-placement.service';
import { BybitExchangeCleanupService } from './position/bybit-exchange-cleanup.service';
import { BybitPositionCloseService } from './position/bybit-position-close.service';
import { BybitNotifyService } from './notify/bybit-notify.service';
import { BybitPnlService } from './pnl/bybit-pnl.service';
import { BybitPollFinalizeService } from './poll/bybit-poll-finalize.service';
import { BybitPollService } from './poll/bybit-poll.service';
import { BybitRecalcService } from './pnl/bybit-recalc.service';
import { BybitSignalOverridesService } from './overrides/bybit-signal-overrides.service';
import { BybitTpSlService } from './tpsl/bybit-tpsl.service';

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
