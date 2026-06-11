import { All, Controller, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { UserbotInternalProxyService } from './userbot-internal-proxy.service';

@ApiTags('Telegram Userbot')
@Controller('telegram-userbot')
export class TelegramUserbotProxyController {
  constructor(private readonly userbotProxy: UserbotInternalProxyService) {}

  @All('*path')
  async proxyAll(@Req() req: Request): Promise<unknown> {
    return this.userbotProxy.forward(req);
  }

  @All()
  async proxyRoot(@Req() req: Request): Promise<unknown> {
    return this.userbotProxy.forward(req);
  }
}
