import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
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
} from './services';

@Module({
  imports: [
    SettingsModule,
    forwardRef(() => TranscriptModule),
    forwardRef(() => BybitModule),
    forwardRef(() => OrdersModule),
    AppLogModule,
  ],
  providers: [
    TelegramConversationStateService,
    TelegramBotRegistryService,
    TelegramSignalDraftFlowService,
    TelegramChatMenuService,
    TelegramDigestSchedulerService,
    TelegramService,
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
