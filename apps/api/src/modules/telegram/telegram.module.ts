import { Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptModule } from '../transcript/transcript.module';
import { TelegramService } from './telegram.service';

@Module({
  imports: [SettingsModule, TranscriptModule, BybitModule, AppLogModule],
  providers: [TelegramService],
})
export class TelegramModule {}
