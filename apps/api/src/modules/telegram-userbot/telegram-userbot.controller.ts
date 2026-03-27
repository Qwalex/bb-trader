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

  @Post('reread-all')
  async rereadAll(@Body() body?: { limit?: number }) {
    return this.userbot.rereadAllIngestMessages(body?.limit);
  }

  @Get('filters/groups')
  async listFilterGroups() {
    return this.userbot.listFilterGroups();
  }

  @Get('filters/examples')
  async listFilterExamples() {
    return this.userbot.listFilterExamples();
  }

  @Get('filters/patterns')
  async listFilterPatterns() {
    return this.userbot.listFilterPatterns();
  }

  @Post('filters/examples')
  async createFilterExample(
    @Body()
    body: {
      groupName?: string;
      kind?: 'signal' | 'close' | 'result' | 'reentry';
      example?: string;
    },
  ) {
    return this.userbot.createFilterExample(body);
  }

  @Post('filters/examples/:id/delete')
  async deleteFilterExample(@Param('id') id: string) {
    return this.userbot.deleteFilterExample(id);
  }

  @Post('filters/patterns')
  async createFilterPattern(
    @Body()
    body: {
      groupName?: string;
      kind?: 'signal' | 'close' | 'result' | 'reentry';
      pattern?: string;
    },
  ) {
    return this.userbot.createFilterPattern(body);
  }

  @Post('filters/patterns/:id/delete')
  async deleteFilterPattern(@Param('id') id: string) {
    return this.userbot.deleteFilterPattern(id);
  }

  @Post('filters/patterns/generate')
  async generateFilterPatterns(
    @Body()
    body: {
      kind?: 'signal' | 'close' | 'result' | 'reentry';
      example?: string;
    },
  ) {
    return this.userbot.generateFilterPatterns(body);
  }

  @Put('chats/:chatId')
  async setChatEnabled(
    @Param('chatId') chatId: string,
    @Body() body: { enabled?: boolean },
  ) {
    return this.userbot.setChatEnabled(chatId, body.enabled === true);
  }
}
