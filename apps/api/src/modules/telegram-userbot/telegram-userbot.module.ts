import { forwardRef, Module } from '@nestjs/common';

import { shouldRunUserbotMtproto } from '../../config/process-role.util';
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
import { ContentGenerationPresetService } from './content-editor/content-generation-preset.service';
import { TelegramUserbotContentEditorService } from './content-editor/telegram-userbot-content-editor.service';
import { TelegramUserbotOpenrouterService } from './openrouter/telegram-userbot-openrouter.service';
import { TelegramUserbotIngestAfterConfirmService } from './ingest/telegram-userbot-ingest-after-confirm.service';
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
  controllers: shouldRunUserbotMtproto() ? [TelegramUserbotController] : [],
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
    TelegramUserbotIngestAfterConfirmService,
    TelegramUserbotPollingService,
    TelegramUserbotScanService,
    TelegramUserbotSettingsService,
    TelegramUserbotFiltersService,
    TelegramUserbotMirrorService,
    TelegramUserbotContentEditorService,
    ContentGenerationPresetService,
    TelegramUserbotService,
  ],
  exports: [
    TelegramUserbotService,
    TelegramUserbotMirrorService,
    TelegramUserbotIngestAfterConfirmService,
  ],
})
export class TelegramUserbotModule {}
