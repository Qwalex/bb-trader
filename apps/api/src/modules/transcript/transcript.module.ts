import { Module, forwardRef } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptService } from './transcript.service';

@Module({
  imports: [
    forwardRef(() => SettingsModule),
    forwardRef(() => AppLogModule),
    forwardRef(() => BybitModule),
  ],
  providers: [TranscriptService],
  exports: [TranscriptService],
})
export class TranscriptModule {}
