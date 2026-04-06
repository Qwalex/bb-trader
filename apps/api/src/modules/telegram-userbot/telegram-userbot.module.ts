import { Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VkModule } from '../vk/vk.module';
import { TranscriptModule } from '../transcript/transcript.module';
import { TelegramUserbotController } from './telegram-userbot.controller';
import { TelegramUserbotService } from './telegram-userbot.service';
import { UserbotSignalHashModule } from './userbot-signal-hash.module';

@Module({
  imports: [
    SettingsModule,
    TranscriptModule,
    BybitModule,
    OrdersModule,
    AppLogModule,
    TelegramModule,
    VkModule,
    UserbotSignalHashModule,
  ],
  controllers: [TelegramUserbotController],
  providers: [TelegramUserbotService],
  exports: [TelegramUserbotService],
})
export class TelegramUserbotModule {}
