import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { CabinetModule } from '../cabinet/cabinet.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramUserbotModule } from '../telegram-userbot/telegram-userbot.module';
import { QpulseSyncService } from './qpulse-sync.service';
import { SignalDistributionService } from './signal-distribution.service';

@Module({
  imports: [
    SettingsModule,
    CabinetModule,
    AppLogModule,
    forwardRef(() => TelegramUserbotModule),
  ],
  providers: [QpulseSyncService, SignalDistributionService],
  exports: [QpulseSyncService, SignalDistributionService],
})
export class QpulseSyncModule {}
