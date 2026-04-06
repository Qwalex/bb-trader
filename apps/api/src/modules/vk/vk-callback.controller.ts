import { Body, Controller, Get, Logger, Post, Res } from '@nestjs/common';
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

  /** GET в браузере не используется ВК; отдаём подсказку вместо 404 «Cannot GET». */
  @Get('callback')
  callbackGet(@Res() res: Response): void {
    res
      .status(200)
      .type('text/plain; charset=utf-8')
      .send(
        'VK Callback API: нужен метод POST (события от ВКонтакте). Открытие в браузере не подтверждает сервер.',
      );
  }

  @Post('callback')
  async callback(@Body() body: unknown, @Res() res: Response): Promise<void> {
    const b = body as Record<string, unknown>;
    const secret = (await this.vkBot.getExpectedSecret())?.trim();
    // Для type=confirmation ВК часто не кладёт secret в JSON, хотя ключ задан в настройках Callback API.
    // Иначе проверка «secret в теле обязателен» даёт 403 и в интерфейсе ВК — «Invalid response code».
    if (secret) {
      const incoming = b?.secret;
      const hasIncoming =
        incoming !== undefined && incoming !== null && String(incoming).length > 0;
      if (hasIncoming && String(incoming) !== secret) {
        this.logger.warn('VK callback: secret mismatch');
        res.status(403).type('text/plain').send('forbidden');
        return;
      }
      if (b?.type !== 'confirmation' && !hasIncoming) {
        this.logger.warn('VK callback: missing secret for non-confirmation event');
        res.status(403).type('text/plain').send('forbidden');
        return;
      }
    }

    if (b?.type === 'confirmation') {
      const code = (await this.vkBot.getConfirmationCode())?.trim() ?? '';
      res.status(200).type('text/plain').send(code);
      return;
    }

    res.type('text/plain').send('ok');

    void this.vkBot.handleCallbackEvent(b).catch((e) => {
      this.logger.error(`VK callback async: ${e instanceof Error ? e.message : e}`);
    });
  }
}
