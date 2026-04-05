import { forwardRef, Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptModule } from '../transcript/transcript.module';

import { VkApiClient } from './vk-api.client';
import { VkBotService } from './vk-bot.service';
import { VkCallbackController } from './vk-callback.controller';
import { VkNotifyMirrorService } from './vk-notify-mirror.service';

@Module({
  imports: [
    SettingsModule,
    TranscriptModule,
    PrismaModule,
    AppLogModule,
    forwardRef(() => BybitModule),
    forwardRef(() => OrdersModule),
  ],
  controllers: [VkCallbackController],
  providers: [VkApiClient, VkBotService, VkNotifyMirrorService],
  exports: [VkNotifyMirrorService],
})
export class VkModule {}
