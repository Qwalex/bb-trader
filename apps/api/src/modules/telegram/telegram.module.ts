import { forwardRef, Module } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptModule } from '../transcript/transcript.module';
import { TelegramBotRegistryService } from './telegram-bot-registry.service';
import { TelegramChatMenuService } from './telegram-chat-menu.service';
import { TelegramConversationStateService } from './telegram-conversation-state.service';
import { TelegramService } from './telegram.service';
import { TelegramSignalDraftFlowService } from './telegram-signal-draft-flow.service';

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
    TelegramService,
  ],
  exports: [TelegramService],
})
export class TelegramModule {}
