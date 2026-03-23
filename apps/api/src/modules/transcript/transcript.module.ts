import { Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptService } from './transcript.service';

@Module({
  imports: [SettingsModule, AppLogModule],
  providers: [TranscriptService],
  exports: [TranscriptService],
})
export class TranscriptModule {}
