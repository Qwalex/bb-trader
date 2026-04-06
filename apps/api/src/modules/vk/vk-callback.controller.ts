import { Body, Controller, Get, Logger, Post, Res } from '@nestjs/common';
import type { Response } from 'express';

import { AppLogService } from '../app-log/app-log.service';
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

  constructor(
    private readonly vkBot: VkBotService,
    private readonly appLog: AppLogService,
  ) {}

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
    const eventType =
      typeof b?.type === 'string' ? b.type : String(b?.type ?? '');
    const groupId = b?.group_id;
    const secret = (await this.vkBot.getExpectedSecret())?.trim();
    const incoming = b?.secret;
    const hasIncoming =
      incoming !== undefined && incoming !== null && String(incoming).length > 0;

    void this.appLog.append('info', 'vk', 'VK callback: inbound', {
      type: eventType || '(empty)',
      group_id: groupId,
      vkSecretConfigured: Boolean(secret),
      secretInBody: hasIncoming,
    });
    this.logger.log(
      `VK callback inbound type=${eventType || '(empty)'} group_id=${String(groupId)} secretCfg=${Boolean(secret)} secretInBody=${hasIncoming}`,
    );

    // Для type=confirmation ВК часто не кладёт secret в JSON, хотя ключ задан в настройках Callback API.
    // Иначе проверка «secret в теле обязателен» даёт 403 и в интерфейсе ВК — «Invalid response code».
    if (secret) {
      if (hasIncoming && String(incoming) !== secret) {
        this.logger.warn('VK callback: secret mismatch');
        void this.appLog.append('warn', 'vk', 'VK callback: denied secret mismatch', {
          type: eventType,
          group_id: groupId,
        });
        res.status(403).type('text/plain').send('forbidden');
        return;
      }
      if (b?.type !== 'confirmation' && !hasIncoming) {
        this.logger.warn('VK callback: missing secret for non-confirmation event');
        void this.appLog.append('warn', 'vk', 'VK callback: denied missing secret', {
          type: eventType,
          group_id: groupId,
        });
        res.status(403).type('text/plain').send('forbidden');
        return;
      }
    }

    if (b?.type === 'confirmation') {
      const code = (await this.vkBot.getConfirmationCode())?.trim() ?? '';
      void this.appLog.append('info', 'vk', 'VK callback: confirmation', {
        group_id: groupId,
        confirmationCodeLength: code.length,
        confirmationEmpty: code.length === 0,
        httpStatus: 200,
      });
      this.logger.log(
        `VK callback confirmation → 200 plain text, codeLen=${code.length}`,
      );
      res.status(200).type('text/plain').send(code);
      return;
    }

    void this.appLog.append('info', 'vk', 'VK callback: ok async', {
      type: eventType,
      group_id: groupId,
    });
    this.logger.log(`VK callback ok → async type=${eventType}`);
    res.type('text/plain').send('ok');

    void this.vkBot.handleCallbackEvent(b).catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`VK callback async: ${msg}`);
      void this.appLog.append('error', 'vk', 'VK callback: async handler error', {
        type: eventType,
        error: msg,
      });
    });
  }
}
