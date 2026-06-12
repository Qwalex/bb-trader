import { Module } from '@nestjs/common';

import {
  buildBybitModuleControllers,
  buildBybitModuleImports,
} from './bybit-module.imports.util';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { BalanceAlertSchedulerService } from './balance-alert/balance-alert-scheduler.service';
import { BalanceAlertService } from './balance-alert/balance-alert.service';
import { BybitService } from './bybit.service';
import { BybitBalanceInstrumentService } from './instrument/bybit-balance-instrument.service';
import { BybitClientService } from './instrument/bybit-client.service';
import { BybitRateLimitService } from './instrument/bybit-rate-limit.service';
import { BybitExposureService } from './exposure/bybit-exposure.service';
import { BybitLiveSnapshotService } from './exposure/bybit-live-snapshot.service';
import { BybitStuckTradesService } from './exposure/bybit-stuck-trades.service';
import { BybitStuckTradesHealService } from './exposure/bybit-stuck-trades-heal.service';
import { BybitStuckTradesHealSchedulerService } from './exposure/bybit-stuck-trades-heal-scheduler.service';
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
import { BybitTpSlFastApplyService } from './tpsl/bybit-tpsl-fast-apply.service';
import { BybitInternalClientService } from './bybit-internal-client.service';

@Module({
  imports: buildBybitModuleImports(),
  controllers: buildBybitModuleControllers(),
  providers: [
    BybitService,
    BybitClientService,
    BybitRateLimitService,
    BybitBalanceInstrumentService,
    BybitOrderExchangeQueryService,
    BybitPlacementValidationService,
    BybitSignalOverridesService,
    BybitLiveSnapshotService,
    BybitStuckTradesService,
    BybitStuckTradesHealService,
    BybitStuckTradesHealSchedulerService,
    BybitPollFinalizeService,
    BybitExchangeCleanupService,
    BybitExposureService,
    BybitTpSlService,
    BybitTpSlFastApplyService,
    BybitPnlService,
    BybitSignalPlacementService,
    BybitOrderLifecyclePollService,
    BybitNotifyService,
    BybitPositionCloseService,
    BybitRecalcService,
    BybitPollService,
    BalanceSnapshotService,
    BalanceAlertService,
    BalanceAlertSchedulerService,
    BybitInternalClientService,
  ],
  exports: [
    BybitService,
    BalanceSnapshotService,
    BybitClientService,
    BybitRateLimitService,
    BybitInternalClientService,
    BybitStuckTradesService,
  ],
})
export class BybitModule {}
