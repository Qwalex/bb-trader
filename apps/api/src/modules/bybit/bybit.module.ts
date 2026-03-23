import { Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { BybitController } from './bybit.controller';
import { BybitPollService } from './bybit-poll.service';
import { BybitService } from './bybit.service';

@Module({
  imports: [SettingsModule, OrdersModule, AppLogModule],
  controllers: [BybitController],
  providers: [BybitService, BybitPollService],
  exports: [BybitService],
})
export class BybitModule {}
