import { Module } from '@nestjs/common';

import { TelegramUserbotProxyController } from './telegram-userbot-proxy.controller';
import { UserbotInternalProxyService } from './userbot-internal-proxy.service';

@Module({
  controllers: [TelegramUserbotProxyController],
  providers: [UserbotInternalProxyService],
  exports: [UserbotInternalProxyService],
})
export class TelegramUserbotProxyModule {}
