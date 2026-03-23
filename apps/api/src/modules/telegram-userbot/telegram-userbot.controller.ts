import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';

import { TelegramUserbotService } from './telegram-userbot.service';

@Controller('telegram-userbot')
export class TelegramUserbotController {
  constructor(private readonly userbot: TelegramUserbotService) {}

  @Get('status')
  async status() {
    return this.userbot.getStatus();
  }

  @Get('metrics/today')
  async metricsToday() {
    return this.userbot.getTodayMetrics();
  }

  @Post('connect')
  async connect() {
    return this.userbot.connectFromStoredSession();
  }

  @Post('disconnect')
  async disconnect() {
    return this.userbot.disconnect();
  }

  @Post('qr/start')
  async startQr() {
    return this.userbot.startQrLogin();
  }

  @Get('qr/status')
  async qrStatus() {
    return this.userbot.getQrStatus();
  }

  @Post('qr/cancel')
  async cancelQr() {
    return this.userbot.cancelQrLogin();
  }

  @Post('chats/sync')
  async syncChats() {
    return this.userbot.syncChats();
  }

  @Get('chats')
  async listChats() {
    return this.userbot.listChats();
  }

  @Post('scan-today')
  async scanToday(@Body() body?: { limitPerChat?: number }) {
    return this.userbot.scanTodayMessages(body?.limitPerChat);
  }

  @Post('reread/:ingestId')
  async reread(@Param('ingestId') ingestId: string) {
    return this.userbot.rereadIngestMessage(ingestId);
  }

  @Put('chats/:chatId')
  async setChatEnabled(
    @Param('chatId') chatId: string,
    @Body() body: { enabled?: boolean },
  ) {
    return this.userbot.setChatEnabled(chatId, body.enabled === true);
  }
}
