import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { TelegramUserbotService } from './telegram-userbot.service';

@ApiTags('Telegram Userbot')
@Controller('telegram-userbot')
export class TelegramUserbotController {
  constructor(private readonly userbot: TelegramUserbotService) {}

  @ApiOperation({ summary: 'Статус userbot' })
  @ApiOkResponse({ description: 'Статус получен' })
  @Get('status')
  async status() {
    return this.userbot.getStatus();
  }

  @ApiOperation({ summary: 'Метрики userbot за сегодня' })
  @ApiOkResponse({ description: 'Метрики получены' })
  @Get('metrics/today')
  async metricsToday() {
    return this.userbot.getTodayMetrics();
  }

  @ApiOperation({ summary: 'Подключить userbot из сохраненной сессии' })
  @ApiOkResponse({ description: 'Подключение выполнено' })
  @Post('connect')
  async connect() {
    return this.userbot.connectFromStoredSession();
  }

  @ApiOperation({ summary: 'Отключить userbot' })
  @ApiOkResponse({ description: 'Отключение выполнено' })
  @Post('disconnect')
  async disconnect() {
    return this.userbot.disconnect();
  }

  @ApiOperation({ summary: 'Начать QR-логин userbot' })
  @ApiOkResponse({ description: 'QR-логин запущен' })
  @Post('qr/start')
  async startQr() {
    return this.userbot.startQrLogin();
  }

  @ApiOperation({ summary: 'Статус QR-логина userbot' })
  @ApiOkResponse({ description: 'Статус QR получен' })
  @Get('qr/status')
  async qrStatus() {
    return this.userbot.getQrStatus();
  }

  @ApiOperation({ summary: 'Отменить QR-логин userbot' })
  @ApiOkResponse({ description: 'QR-логин отменён' })
  @Post('qr/cancel')
  async cancelQr() {
    return this.userbot.cancelQrLogin();
  }

  @ApiOperation({ summary: 'Синхронизировать чаты userbot' })
  @ApiOkResponse({ description: 'Синхронизация чатов выполнена' })
  @Post('chats/sync')
  async syncChats() {
    return this.userbot.syncChats();
  }

  @ApiOperation({ summary: 'Список чатов userbot' })
  @ApiOkResponse({ description: 'Список чатов получен' })
  @Get('chats')
  async listChats() {
    return this.userbot.listChats();
  }

  @ApiOperation({ summary: 'Расход OpenRouter по источникам' })
  @ApiQuery({
    name: 'period',
    required: false,
    enum: ['day', '3d', 'week', 'month', 'year'],
  })
  @ApiOkResponse({ description: 'Агрегированная статистика OpenRouter получена' })
  @Get('openrouter-spend')
  async openrouterSpend(
    @Query('period') period?: 'day' | '3d' | 'week' | 'month' | 'year',
  ) {
    return this.userbot.getOpenrouterSpendAnalytics(period ?? 'day');
  }

  /**
   * Сообщения из TgUserbotIngest для ручной привязки сделки (chat id + message id).
   */
  @ApiOperation({ summary: 'Кандидаты ingest для ручной привязки сделки' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'chatId', required: false })
  @ApiOkResponse({ description: 'Кандидаты получены' })
  @Get('ingest-link-candidates')
  async ingestLinkCandidates(
    @Query('limit') limit?: string,
    @Query('chatId') chatId?: string,
  ) {
    const raw = limit ? parseInt(limit, 10) : undefined;
    const n = Number.isFinite(raw) ? raw : undefined;
    return this.userbot.listIngestLinkCandidates({
      limit: n,
      chatId: typeof chatId === 'string' ? chatId : undefined,
    });
  }

  @ApiOperation({ summary: 'Сканировать сообщения за сегодня' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { limitPerChat: { type: 'number' } },
    },
  })
  @ApiOkResponse({ description: 'Сканирование завершено' })
  @Post('scan-today')
  async scanToday(@Body() body?: { limitPerChat?: number }) {
    return this.userbot.scanTodayMessages(body?.limitPerChat);
  }

  @ApiOperation({ summary: 'Перечитать ingest-сообщение по ID' })
  @ApiParam({ name: 'ingestId', description: 'ID ingest-записи' })
  @ApiOkResponse({ description: 'Перечитывание выполнено' })
  @Post('reread/:ingestId')
  async reread(@Param('ingestId') ingestId: string) {
    return this.userbot.rereadIngestMessage(ingestId);
  }

  @ApiOperation({ summary: 'Перечитать batch ingest-сообщений' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  })
  @ApiOkResponse({ description: 'Batch-перечитывание выполнено' })
  @Post('reread-all')
  async rereadAll(@Body() body?: { limit?: number }) {
    return this.userbot.rereadAllIngestMessages(body?.limit);
  }

  @ApiOperation({ summary: 'Список групп фильтров' })
  @ApiOkResponse({ description: 'Группы фильтров получены' })
  @Get('filters/groups')
  async listFilterGroups() {
    return this.userbot.listFilterGroups();
  }

  @ApiOperation({ summary: 'Список фильтр-примеров' })
  @ApiOkResponse({ description: 'Примеры фильтров получены' })
  @Get('filters/examples')
  async listFilterExamples() {
    return this.userbot.listFilterExamples();
  }

  @ApiOperation({ summary: 'Список regex-паттернов фильтров' })
  @ApiOkResponse({ description: 'Паттерны фильтров получены' })
  @Get('filters/patterns')
  async listFilterPatterns() {
    return this.userbot.listFilterPatterns();
  }

  @ApiOperation({ summary: 'Список publish-групп' })
  @ApiOkResponse({ description: 'Publish-группы получены' })
  @Get('publish-groups')
  async listPublishGroups() {
    return this.userbot.listPublishGroups();
  }

  @ApiOperation({ summary: 'Создать или обновить publish-группу' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        chatId: { type: 'string' },
        enabled: { type: 'boolean' },
        publishEveryN: { type: 'number' },
      },
    },
  })
  @ApiOkResponse({ description: 'Publish-группа сохранена' })
  @Post('publish-groups')
  async createOrUpdatePublishGroup(
    @Body()
    body: {
      id?: string;
      title?: string;
      chatId?: string;
      enabled?: boolean;
      publishEveryN?: number;
    },
  ) {
    return this.userbot.createOrUpdatePublishGroup(body);
  }

  @ApiOperation({ summary: 'Удалить publish-группу' })
  @ApiParam({ name: 'id', description: 'ID publish-группы' })
  @ApiOkResponse({ description: 'Publish-группа удалена' })
  @Post('publish-groups/:id/delete')
  async deletePublishGroup(@Param('id') id: string) {
    return this.userbot.deletePublishGroup(id);
  }

  @ApiOperation({ summary: 'Создать фильтр-пример' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        groupName: { type: 'string' },
        kind: { type: 'string', enum: ['signal', 'close', 'result', 'reentry'] },
        example: { type: 'string' },
        requiresQuote: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ description: 'Фильтр-пример создан' })
  @Post('filters/examples')
  async createFilterExample(
    @Body()
    body: {
      groupName?: string;
      kind?: 'signal' | 'close' | 'result' | 'reentry';
      example?: string;
      requiresQuote?: boolean;
    },
  ) {
    return this.userbot.createFilterExample(body);
  }

  @ApiOperation({ summary: 'Удалить фильтр-пример' })
  @ApiParam({ name: 'id', description: 'ID фильтр-примера' })
  @ApiOkResponse({ description: 'Фильтр-пример удалён' })
  @Post('filters/examples/:id/delete')
  async deleteFilterExample(@Param('id') id: string) {
    return this.userbot.deleteFilterExample(id);
  }

  @ApiOperation({ summary: 'Создать regex-паттерн фильтра' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        groupName: { type: 'string' },
        kind: { type: 'string', enum: ['signal', 'close', 'result', 'reentry'] },
        pattern: { type: 'string' },
        requiresQuote: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ description: 'Паттерн фильтра создан' })
  @Post('filters/patterns')
  async createFilterPattern(
    @Body()
    body: {
      groupName?: string;
      kind?: 'signal' | 'close' | 'result' | 'reentry';
      pattern?: string;
      requiresQuote?: boolean;
    },
  ) {
    return this.userbot.createFilterPattern(body);
  }

  @ApiOperation({ summary: 'Удалить regex-паттерн фильтра' })
  @ApiParam({ name: 'id', description: 'ID паттерна' })
  @ApiOkResponse({ description: 'Паттерн удалён' })
  @Post('filters/patterns/:id/delete')
  async deleteFilterPattern(@Param('id') id: string) {
    return this.userbot.deleteFilterPattern(id);
  }

  @ApiOperation({ summary: 'Сгенерировать regex-паттерны по примеру' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['signal', 'close', 'result', 'reentry'] },
        example: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'Паттерны сгенерированы' })
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

  @ApiOperation({ summary: 'Обновить настройки конкретного чата' })
  @ApiParam({ name: 'chatId', description: 'Telegram chatId' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        defaultLeverage: { type: 'number', nullable: true },
        defaultEntryUsd: { type: 'string', nullable: true },
        martingaleMultiplier: { type: 'number', nullable: true },
        sourcePriority: { type: 'number', nullable: true },
        minLotBump: {
          type: 'boolean',
          nullable: true,
          description: 'null — наследовать глобальный BUMP_TO_MIN_EXCHANGE_LOT',
        },
        tpSlStepStart: {
          type: 'string',
          nullable: true,
          description:
            'null — наследовать глобальный TP_SL_STEP_START; off | tp1 | tp2 | tp3 | tp4 | tp5',
        },
      },
    },
  })
  @ApiOkResponse({ description: 'Настройки чата обновлены' })
  @Put('chats/:chatId')
  async updateChat(
    @Param('chatId') chatId: string,
    @Body()
    body: {
      enabled?: boolean;
      defaultLeverage?: number | null;
      defaultEntryUsd?: string | null;
      martingaleMultiplier?: number | null;
      sourcePriority?: number | null;
      minLotBump?: boolean | null;
      tpSlStepStart?: string | null;
    },
  ) {
    return this.userbot.updateChat(chatId, body);
  }
}
