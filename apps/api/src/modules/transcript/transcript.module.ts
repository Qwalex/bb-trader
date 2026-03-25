import { Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptService } from './transcript.service';

@Module({
  imports: [SettingsModule, AppLogModule, BybitModule],
  providers: [TranscriptService],
  exports: [TranscriptService],
})
export class TranscriptModule {}
