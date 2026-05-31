import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { BybitSpotModule } from '../bybit-spot/bybit-spot.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { TelegramModule } from '../telegram';
import { VkModule } from '../vk/vk.module';
import { TranscriptModule } from '../transcript/transcript.module';
import { TelegramUserbotClientService } from './client/telegram-userbot-client.service';
import { TelegramUserbotFiltersService } from './filters/telegram-userbot-filters.service';
import { TelegramUserbotIngestService } from './ingest/telegram-userbot-ingest.service';
import { TelegramUserbotIngestEditWatchService } from './ingest/telegram-userbot-ingest-edit-watch.service';
import { TelegramUserbotIngestParseRetryService } from './ingest/telegram-userbot-ingest-parse-retry.service';
import { TelegramUserbotIngestPairDirectionService } from './ingest/telegram-userbot-ingest-pair-direction.service';
import { TelegramUserbotIngestPipelineService } from './ingest/telegram-userbot-ingest-pipeline.service';
import { TelegramUserbotIngestSignalLookupService } from './ingest/telegram-userbot-ingest-signal-lookup.service';
import { TelegramUserbotIngestSignalReplyService } from './ingest/telegram-userbot-ingest-signal-reply.service';
import { TelegramUserbotPollingService } from './polling/telegram-userbot-polling.service';
import { TelegramUserbotScanService } from './scan/telegram-userbot-scan.service';
import { TelegramUserbotSettingsService } from './settings/telegram-userbot-settings.service';
import { TelegramUserbotMirrorService } from './mirror/telegram-userbot-mirror.service';
import { TelegramUserbotOpenrouterService } from './openrouter/telegram-userbot-openrouter.service';
import { TelegramUserbotController } from './telegram-userbot.controller';
import { TelegramUserbotService } from './telegram-userbot.service';
import { UserbotSignalHashModule } from './userbot-signal-hash.module';
import { QpulseSyncModule } from '../qpulse-sync/qpulse-sync.module';

@Module({
  imports: [
    SettingsModule,
    TranscriptModule,
    forwardRef(() => BybitModule),
    forwardRef(() => BybitSpotModule),
    forwardRef(() => OrdersModule),
    AppLogModule,
    forwardRef(() => TelegramModule),
    forwardRef(() => VkModule),
    UserbotSignalHashModule,
    forwardRef(() => QpulseSyncModule),
  ],
  controllers: [TelegramUserbotController],
  providers: [
    TelegramUserbotOpenrouterService,
    TelegramUserbotClientService,
    TelegramUserbotIngestService,
    TelegramUserbotIngestPairDirectionService,
    TelegramUserbotIngestSignalLookupService,
    TelegramUserbotIngestEditWatchService,
    TelegramUserbotIngestParseRetryService,
    TelegramUserbotIngestSignalReplyService,
    TelegramUserbotIngestPipelineService,
    TelegramUserbotPollingService,
    TelegramUserbotScanService,
    TelegramUserbotSettingsService,
    TelegramUserbotFiltersService,
    TelegramUserbotMirrorService,
    TelegramUserbotService,
  ],
  exports: [TelegramUserbotService, TelegramUserbotMirrorService],
})
export class TelegramUserbotModule {}
