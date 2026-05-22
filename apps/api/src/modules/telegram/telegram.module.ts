import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { BybitSpotModule } from '../bybit-spot/bybit-spot.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptModule } from '../transcript/transcript.module';
import {
  TelegramBotRegistryService,
  TelegramChatMenuService,
  TelegramConversationStateService,
  TelegramDigestSchedulerService,
  TelegramService,
  TelegramSignalDraftFlowService,
  TelegramSpotFlowService,
} from './services';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => TranscriptModule),
    forwardRef(() => BybitModule),
    forwardRef(() => BybitSpotModule),
    forwardRef(() => OrdersModule),
    AppLogModule,
  ],
  providers: [
    TelegramConversationStateService,
    TelegramBotRegistryService,
    TelegramSignalDraftFlowService,
    TelegramChatMenuService,
    TelegramDigestSchedulerService,
    TelegramSpotFlowService,
    TelegramService,
  ],
  exports: [TelegramService, TelegramSpotFlowService],
})
export class TelegramModule {}
