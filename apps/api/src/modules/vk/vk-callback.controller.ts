import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { VkBotService } from './vk-bot.service';

/**
 * VK Callback API сообщества.
 *
 * Публичный URL (за nginx к API), например:
 *   https://<host>/<префикс-api>/vk/callback
 * Пример префикса: /trade-api → полный путь /trade-api/vk/callback
 * В настройках группы VK укажите этот URL и включите события message_new, message_event.
 */
@Controller('vk')
export class VkCallbackController {
  private readonly logger = new Logger(VkCallbackController.name);

  constructor(private readonly vkBot: VkBotService) {}

  @Post('callback')
  async callback(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const b = body as Record<string, unknown>;
    const secret = (await this.vkBot.getExpectedSecret())?.trim();
    if (secret && b?.secret !== secret) {
      this.logger.warn('VK callback: secret mismatch');
      res.status(403).type('text/plain').send('forbidden');
      return;
    }

    if (b?.type === 'confirmation') {
      const code = (await this.vkBot.getConfirmationCode())?.trim() ?? '';
      res.type('text/plain').send(code);
      return;
    }

    res.type('text/plain').send('ok');

    void this.vkBot.handleCallbackEvent(b).catch((e) => {
      this.logger.error(`VK callback async: ${e instanceof Error ? e.message : e}`);
    });
  }
}
