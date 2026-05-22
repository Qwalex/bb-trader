import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { OrdersModule } from '../orders/orders.module';
import { TelegramModule } from '../telegram';
import { BybitSpotService } from './bybit-spot.service';
import { BybitSpotInstrumentService } from './instrument/bybit-spot-instrument.service';
import { BybitSpotOrderQueryService } from './orders/bybit-spot-order-query.service';
import { BybitSpotPlacementService } from './orders/bybit-spot-placement.service';
import { BybitSpotLifecyclePollService } from './poll/bybit-spot-lifecycle-poll.service';
import { BybitSpotPriceWatchService } from './watch/bybit-spot-price-watch.service';

@Module({
  imports: [
    AppLogModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => BybitModule),
    forwardRef(() => TelegramModule),
  ],
  providers: [
    BybitSpotInstrumentService,
    BybitSpotOrderQueryService,
    BybitSpotPlacementService,
    BybitSpotPriceWatchService,
    BybitSpotLifecyclePollService,
    BybitSpotService,
  ],
  exports: [BybitSpotService, BybitSpotPlacementService, BybitSpotInstrumentService],
})
export class BybitSpotModule {}
