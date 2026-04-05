import { Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram/telegram.module';
import { TranscriptModule } from '../transcript/transcript.module';
import { TelegramUserbotController } from './telegram-userbot.controller';
import { TelegramUserbotService } from './telegram-userbot.service';
import { UserbotPublishService } from './userbot-publish.service';
import { UserbotSignalHashModule } from './userbot-signal-hash.module';

@Module({
  imports: [
    SettingsModule,
    TranscriptModule,
    BybitModule,
    AppLogModule,
    TelegramModule,
    UserbotSignalHashModule,
  ],
  controllers: [TelegramUserbotController],
  providers: [UserbotPublishService, TelegramUserbotService],
  exports: [TelegramUserbotService],
})
export class TelegramUserbotModule {}
