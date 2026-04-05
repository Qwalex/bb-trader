import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { requireWorkspaceId } from '../../common/require-workspace-id';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import { TelegramUserbotService } from './telegram-userbot.service';

@ApiTags('Telegram Userbot')
@Controller('telegram-userbot')
export class TelegramUserbotController {
  constructor(private readonly userbot: TelegramUserbotService) {}

  @ApiOperation({ summary: 'Статус userbot' })
  @ApiOkResponse({ description: 'Статус получен' })
  @Get('status')
  async status(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.getStatus(workspaceId);
  }

  @ApiOperation({ summary: 'Метрики userbot за сегодня' })
  @ApiOkResponse({ description: 'Метрики получены' })
  @Get('metrics/today')
  async metricsToday(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.getTodayMetrics(workspaceId);
  }

  @ApiOperation({ summary: 'Подключить userbot из сохраненной сессии' })
  @ApiOkResponse({ description: 'Подключение выполнено' })
  @Post('connect')
  async connect(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.connectFromStoredSession(workspaceId);
  }

  @ApiOperation({ summary: 'Отключить userbot' })
  @ApiOkResponse({ description: 'Отключение выполнено' })
  @Post('disconnect')
  async disconnect(@CurrentUser() user: AuthenticatedRequestContext | null) {
    requireWorkspaceId(user);
    return this.userbot.disconnect();
  }

  @ApiOperation({ summary: 'Начать QR-логин userbot' })
  @ApiOkResponse({ description: 'QR-логин запущен' })
  @Post('qr/start')
  async startQr(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.startQrLogin(workspaceId);
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
  async syncChats(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.syncChats(workspaceId);
  }

  @ApiOperation({ summary: 'Список чатов userbot' })
  @ApiOkResponse({ description: 'Список чатов получен' })
  @Get('chats')
  async listChats(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.listChats(workspaceId);
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Query('limit') limit?: string,
    @Query('chatId') chatId?: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    const raw = limit ? parseInt(limit, 10) : undefined;
    const n = Number.isFinite(raw) ? raw : undefined;
    return this.userbot.listIngestLinkCandidates({
      limit: n,
      chatId: typeof chatId === 'string' ? chatId : undefined,
      workspaceId,
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
  async scanToday(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body?: { limitPerChat?: number },
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.scanTodayMessages(body?.limitPerChat, workspaceId);
  }

  @ApiOperation({ summary: 'Перечитать ingest-сообщение по ID' })
  @ApiParam({ name: 'ingestId', description: 'ID ingest-записи' })
  @ApiOkResponse({ description: 'Перечитывание выполнено' })
  @Post('reread/:ingestId')
  async reread(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('ingestId') ingestId: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.rereadIngestMessage(ingestId, workspaceId);
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
  async rereadAll(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body?: { limit?: number },
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.rereadAllIngestMessages(body?.limit, workspaceId);
  }

  @ApiOperation({ summary: 'Список групп фильтров' })
  @ApiOkResponse({ description: 'Группы фильтров получены' })
  @Get('filters/groups')
  async listFilterGroups(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.listFilterGroups(workspaceId);
  }

  @ApiOperation({ summary: 'Список фильтр-примеров' })
  @ApiOkResponse({ description: 'Примеры фильтров получены' })
  @Get('filters/examples')
  async listFilterExamples(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.listFilterExamples(workspaceId);
  }

  @ApiOperation({ summary: 'Список regex-паттернов фильтров' })
  @ApiOkResponse({ description: 'Паттерны фильтров получены' })
  @Get('filters/patterns')
  async listFilterPatterns(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.listFilterPatterns(workspaceId);
  }

  @ApiOperation({ summary: 'Список publish-групп' })
  @ApiOkResponse({ description: 'Publish-группы получены' })
  @Get('publish-groups')
  async listPublishGroups(@CurrentUser() user: AuthenticatedRequestContext | null) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.listPublishGroups(workspaceId);
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body()
    body: {
      id?: string;
      title?: string;
      chatId?: string;
      enabled?: boolean;
      publishEveryN?: number;
    },
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.createOrUpdatePublishGroup(body, workspaceId);
  }

  @ApiOperation({ summary: 'Удалить publish-группу' })
  @ApiParam({ name: 'id', description: 'ID publish-группы' })
  @ApiOkResponse({ description: 'Publish-группа удалена' })
  @Post('publish-groups/:id/delete')
  async deletePublishGroup(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.deletePublishGroup(id, workspaceId);
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body()
    body: {
      groupName?: string;
      kind?: 'signal' | 'close' | 'result' | 'reentry';
      example?: string;
      requiresQuote?: boolean;
    },
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.createFilterExample(body, workspaceId);
  }

  @ApiOperation({ summary: 'Удалить фильтр-пример' })
  @ApiParam({ name: 'id', description: 'ID фильтр-примера' })
  @ApiOkResponse({ description: 'Фильтр-пример удалён' })
  @Post('filters/examples/:id/delete')
  async deleteFilterExample(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.deleteFilterExample(id, workspaceId);
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body()
    body: {
      groupName?: string;
      kind?: 'signal' | 'close' | 'result' | 'reentry';
      pattern?: string;
      requiresQuote?: boolean;
    },
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.createFilterPattern(body, workspaceId);
  }

  @ApiOperation({ summary: 'Удалить regex-паттерн фильтра' })
  @ApiParam({ name: 'id', description: 'ID паттерна' })
  @ApiOkResponse({ description: 'Паттерн удалён' })
  @Post('filters/patterns/:id/delete')
  async deleteFilterPattern(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.deleteFilterPattern(id, workspaceId);
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body()
    body: {
      kind?: 'signal' | 'close' | 'result' | 'reentry';
      example?: string;
    },
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.generateFilterPatterns(body, workspaceId);
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
      },
    },
  })
  @ApiOkResponse({ description: 'Настройки чата обновлены' })
  @Put('chats/:chatId')
  async updateChat(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('chatId') chatId: string,
    @Body()
    body: {
      enabled?: boolean;
      defaultLeverage?: number | null;
      defaultEntryUsd?: string | null;
      martingaleMultiplier?: number | null;
      sourcePriority?: number | null;
      minLotBump?: boolean | null;
    },
  ) {
    const workspaceId = requireWorkspaceId(user);
    return this.userbot.updateChat(chatId, body, workspaceId);
  }
}
