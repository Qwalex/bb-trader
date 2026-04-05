import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram/telegram.module';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { BybitClientService } from './bybit-client.service';
import { BybitController } from './bybit.controller';
import { BybitExposureService } from './bybit-exposure.service';
import { BybitMarketService } from './bybit-market.service';
import { BybitOrderSyncService } from './bybit-order-sync.service';
import { BybitPlacementService } from './bybit-placement.service';
import { BybitPollService } from './bybit-poll.service';
import { BybitPnlService } from './bybit-pnl.service';
import { BybitService } from './bybit.service';

@Module({
  imports: [
    PrismaModule,
    SettingsModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => TelegramModule),
    AppLogModule,
  ],
  controllers: [BybitController],
  providers: [
    BybitClientService,
    BybitMarketService,
    BybitExposureService,
    BybitPnlService,
    BybitPlacementService,
    BybitOrderSyncService,
    BybitService,
    BybitPollService,
    BalanceSnapshotService,
  ],
  exports: [BybitService, BalanceSnapshotService],
})
export class BybitModule {}
