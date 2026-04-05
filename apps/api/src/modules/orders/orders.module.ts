import { forwardRef, Module } from '@nestjs/common';

import { BybitModule } from '../bybit/bybit.module';
import { SettingsModule } from '../settings/settings.module';
import { UserbotSignalHashModule } from '../telegram-userbot/userbot-signal-hash.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    forwardRef(() => BybitModule),
    UserbotSignalHashModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
