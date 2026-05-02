import { Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram/telegram.module';
import { VkModule } from '../vk/vk.module';
import { TranscriptModule } from '../transcript/transcript.module';
import { TelegramUserbotClientService } from './client/telegram-userbot-client.service';
import { TelegramUserbotFiltersService } from './filters/telegram-userbot-filters.service';
import { TelegramUserbotIngestService } from './ingest/telegram-userbot-ingest.service';
import { TelegramUserbotIngestPipelineService } from './ingest/telegram-userbot-ingest-pipeline.service';
import { TelegramUserbotPollingService } from './polling/telegram-userbot-polling.service';
import { TelegramUserbotScanService } from './scan/telegram-userbot-scan.service';
import { TelegramUserbotSettingsService } from './settings/telegram-userbot-settings.service';
import { TelegramUserbotMirrorService } from './mirror/telegram-userbot-mirror.service';
import { TelegramUserbotOpenrouterService } from './openrouter/telegram-userbot-openrouter.service';
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
  providers: [
    TelegramUserbotOpenrouterService,
    TelegramUserbotClientService,
    TelegramUserbotIngestPipelineService,
    TelegramUserbotIngestService,
    TelegramUserbotPollingService,
    TelegramUserbotScanService,
    TelegramUserbotSettingsService,
    TelegramUserbotFiltersService,
    TelegramUserbotMirrorService,
    TelegramUserbotService,
  ],
  exports: [TelegramUserbotService],
})
export class TelegramUserbotModule {}
