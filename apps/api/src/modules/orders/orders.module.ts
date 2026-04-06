import { forwardRef, Module } from '@nestjs/common';

import { BybitModule } from '../bybit/bybit.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram/telegram.module';
import { UserbotSignalHashModule } from '../telegram-userbot/userbot-signal-hash.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => BybitModule),
    forwardRef(() => TelegramModule),
    UserbotSignalHashModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
