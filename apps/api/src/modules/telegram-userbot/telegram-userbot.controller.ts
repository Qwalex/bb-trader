import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { TelegramUserbotService } from './telegram-userbot.service';
import { pickRequestedCabinetId } from '../../common/cabinet-request.util';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';

type AuthReq = {
  headers?: Record<string, string | string[] | undefined>;
  auth?: { userId?: string };
};

@ApiTags('Telegram Userbot')
@Controller('telegram-userbot')
export class TelegramUserbotController {
  constructor(
    private readonly userbot: TelegramUserbotService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private async runWithCabinet<T>(
    req: AuthReq,
    queryCabinetId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const requested = pickRequestedCabinetId({
      queryCabinetId,
      headers: req.headers,
    });
    const userId = String(req.auth?.userId ?? '').trim() || null;
    const cabinetId = await this.cabinets.resolveCabinetIdForUser(userId, requested);
    return this.cabinetContext.runWithCabinetAsync(cabinetId, fn);
  }

  private parseLimit(raw: string | undefined, fallback: number, max = 500): number {
    const n = raw ? Number.parseInt(raw, 10) : fallback;
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return Math.min(Math.max(Math.trunc(n), 1), max);
  }

  @ApiOperation({ summary: 'Статус userbot' })
  @ApiOkResponse({ description: 'Статус получен' })
  @Get('status')
  async status(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.getStatus());
  }

  @ApiOperation({ summary: 'Метрики userbot за сегодня' })
  @ApiOkResponse({ description: 'Метрики получены' })
  @Get('metrics/today')
  async metricsToday(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.getTodayMetrics());
  }

  @ApiOperation({ summary: 'Подключить userbot из сохраненной сессии' })
  @ApiOkResponse({ description: 'Подключение выполнено' })
  @Post('connect')
  async connect(@Req() req: AuthReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.connectFromStoredSession());
  }

  @ApiOperation({ summary: 'Отключить userbot' })
  @ApiOkResponse({ description: 'Отключение выполнено' })
  @Post('disconnect')
  async disconnect(@Req() req: AuthReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.disconnect());
  }

  @ApiOperation({ summary: 'Начать QR-логин userbot' })
  @ApiOkResponse({ description: 'QR-логин запущен' })
  @Post('qr/start')
  async startQr(@Req() req: AuthReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.startQrLogin());
  }

  @ApiOperation({ summary: 'Статус QR-логина userbot' })
  @ApiOkResponse({ description: 'Статус QR получен' })
  @Get('qr/status')
  async qrStatus(@Req() req: AuthReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.getQrStatus());
  }

  @ApiOperation({ summary: 'Отменить QR-логин userbot' })
  @ApiOkResponse({ description: 'QR-логин отменён' })
  @Post('qr/cancel')
  async cancelQr(@Req() req: AuthReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.cancelQrLogin());
  }

  @ApiOperation({
    summary: 'Пароль 2FA при QR-входе userbot',
    description:
      'После сканирования QR Telegram может запросить пароль облака. Пароль не сохраняется в настройках, только передаётся в текущую сессию входа.',
  })
  @ApiBody({ schema: { properties: { password: { type: 'string' } }, required: ['password'] } })
  @ApiOkResponse({ description: 'Пароль принят или отклонён' })
  @Post('qr/password')
  async submitQrPassword(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body: { password?: string },
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.userbot.submitQrPassword(String(body.password ?? '')),
    );
  }

  @ApiOperation({
    summary: 'Подключённые группы (включённые источники) для дашборда',
    description: 'Список чатов с enabled=true для текущего кабинета.',
  })
  @ApiOkResponse({ description: 'Список получен' })
  @Get('dashboard-connected-groups')
  async dashboardConnectedGroups(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.listEnabledConnectedGroups());
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

  @ApiOperation({ summary: 'Текущий баланс OpenRouter' })
  @ApiOkResponse({ description: 'Текущий баланс OpenRouter получен' })
  @Get('openrouter-balance')
  async openrouterBalance() {
    return this.userbot.getOpenrouterBalance();
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
    return this.userbot.listIngestLinkCandidates({
      limit: this.parseLimit(limit, 100, 500),
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
  @ApiQuery({ name: 'cabinetId', required: false, description: 'Кабинет (query или x-cabinet-id)' })
  @ApiOkResponse({ description: 'Перечитывание выполнено' })
  @Post('reread/:ingestId')
  async reread(
    @Req() req: AuthReq,
    @Param('ingestId') ingestId: string,
    @Query('cabinetId') cabinetId?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.userbot.rereadIngestMessage(ingestId),
    );
  }

  @ApiOperation({ summary: 'Перечитать batch ingest-сообщений' })
  @ApiQuery({ name: 'cabinetId', required: false, description: 'Кабинет (query или x-cabinet-id)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  })
  @ApiOkResponse({ description: 'Batch-перечитывание выполнено' })
  @Post('reread-all')
  async rereadAll(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
    @Body() body?: { limit?: number },
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.userbot.rereadAllIngestMessages(body?.limit),
    );
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
        linkedToApp: { type: 'boolean' },
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
      linkedToApp?: boolean;
    },
  ) {
    return this.userbot.createOrUpdatePublishGroup(body);
  }

  @ApiOperation({ summary: 'Настройки синхронизации QPulse (кабинет)' })
  @Get('qpulse-settings')
  async getQpulseSettings() {
    return this.userbot.getQpulseSettings();
  }

  @ApiOperation({ summary: 'Сохранить настройки синхронизации QPulse' })
  @Post('qpulse-settings')
  async saveQpulseSettings(
    @Body()
    body: {
      enabled?: boolean;
      apiUrl?: string;
      apiKey?: string;
    },
  ) {
    return this.userbot.saveQpulseSettings(body);
  }

  @ApiOperation({ summary: 'Удалить publish-группу' })
  @ApiParam({ name: 'id', description: 'ID publish-группы' })
  @ApiOkResponse({ description: 'Publish-группа удалена' })
  @Post('publish-groups/:id/delete')
  async deletePublishGroup(@Param('id') id: string) {
    return this.userbot.deletePublishGroup(id);
  }

  @ApiOperation({ summary: 'Список постов редактора контента' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'classification', required: false })
  @ApiQuery({ name: 'sourceChatId', required: false })
  @ApiQuery({ name: 'q', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get('content/posts')
  async listContentPosts(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Query('status') status?: string,
    @Query('classification') classification?: string,
    @Query('sourceChatId') sourceChatId?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.userbot.listContentPosts({
        status,
        classification,
        sourceChatId,
        q,
        from,
        to,
        cursor,
        limit: this.parseLimit(limit, 100),
      }),
    );
  }

  @ApiOperation({ summary: 'Настройки сбора контента (kinds)' })
  @Get('content/collect-settings')
  async getContentCollectSettings(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.getContentCollectSettings());
  }

  @ApiOperation({ summary: 'Сохранить настройки сбора контента' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        kinds: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @Put('content/collect-settings')
  async saveContentCollectSettings(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body: { kinds?: string[] },
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.saveContentCollectSettings(body));
  }

  @ApiOperation({ summary: 'Список пресетов генерации контента' })
  @Get('content/presets')
  async listContentPresets(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.listContentPresets());
  }

  @ApiOperation({ summary: 'Создать пресет генерации контента' })
  @Post('content/presets')
  async createContentPreset(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body()
    body: {
      name?: string;
      enabled?: boolean;
      sourceKinds?: string[];
      sourceGroupIds?: string[];
      aiInstruction?: string;
      outputStyle?: string | null;
      dailyLimit?: number;
      scheduleCron?: string | null;
      autoPublish?: boolean;
      targetGroupIds?: string[];
    },
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.createContentPreset(body));
  }

  @ApiOperation({ summary: 'Обновить пресет генерации контента' })
  @Put('content/presets/:id')
  async updateContentPreset(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      enabled?: boolean;
      sourceKinds?: string[];
      sourceGroupIds?: string[];
      aiInstruction?: string;
      outputStyle?: string | null;
      dailyLimit?: number;
      scheduleCron?: string | null;
      autoPublish?: boolean;
      targetGroupIds?: string[];
    },
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.updateContentPreset(id, body));
  }

  @ApiOperation({ summary: 'Удалить пресет генерации контента' })
  @Delete('content/presets/:id')
  async deleteContentPreset(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.deleteContentPreset(id));
  }

  @ApiOperation({ summary: 'Журнал запусков пресета' })
  @Get('content/presets/:id/runs')
  async listContentPresetRuns(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.userbot.listContentPresetRuns(id, this.parseLimit(limit, 20, 100)),
    );
  }

  @ApiOperation({ summary: 'Запустить пресет генерации вручную' })
  @Post('content/presets/:id/run')
  async runContentPreset(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Body() body: { postIds?: string[]; force?: boolean },
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.runContentPreset(id, body));
  }

  @ApiOperation({ summary: 'Сгенерировать контент из постов или пресета' })
  @Post('content/generate')
  async generateContent(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body()
    body: {
      presetId?: string;
      postIds?: string[];
      instruction?: string;
      outputKind?: string;
    },
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.generateContent(body));
  }

  @ApiOperation({ summary: 'Получить пост редактора контента' })
  @Get('content/posts/:id')
  async getContentPost(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.getContentPost(id));
  }

  @ApiOperation({ summary: 'Сохранить черновик поста' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { editedText: { type: 'string', nullable: true } },
    },
  })
  @Put('content/posts/:id')
  async updateContentPost(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Body() body: { editedText?: string | null },
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.updateContentPost(id, body));
  }

  @ApiOperation({ summary: 'Переписать пост через OpenRouter' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { instruction: { type: 'string' } },
    },
  })
  @Post('content/posts/:id/ai-rewrite')
  async aiRewriteContentPost(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Body() body: { instruction?: string },
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.aiRewriteContentPost(id, body));
  }

  @ApiOperation({ summary: 'Опубликовать пост в группы с contentPublishEnabled' })
  @Post('content/posts/:id/publish')
  async publishContentPost(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.publishContentPost(id));
  }

  @ApiOperation({ summary: 'Удалить пост редактора контента' })
  @Delete('content/posts/:id')
  async deleteContentPost(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.deleteContentPost(id));
  }

  @ApiOperation({ summary: 'Сохранить выбор групп для публикации контента' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        enabledGroupIds: { type: 'array', items: { type: 'string' } },
      },
    },
  })
  @Put('content/publish-groups')
  async saveContentPublishGroups(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body: { enabledGroupIds?: string[] },
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.userbot.saveContentPublishGroups(body));
  }

  @ApiOperation({ summary: 'Создать фильтр-пример' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        groupName: { type: 'string' },
        kind: {
          type: 'string',
          enum: ['signal', 'close', 'result', 'reentry', 'ad', 'analysis', 'promo', 'content', 'ignore'],
        },
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
      kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
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
        kind: {
          type: 'string',
          enum: ['signal', 'close', 'result', 'reentry', 'ad', 'analysis', 'promo', 'content', 'ignore'],
        },
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
      kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
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
        kind: {
          type: 'string',
          enum: ['signal', 'close', 'result', 'reentry', 'ad', 'analysis', 'promo', 'content', 'ignore'],
        },
        example: { type: 'string' },
      },
    },
  })
  @ApiOkResponse({ description: 'Паттерны сгенерированы' })
  @Post('filters/patterns/generate')
  async generateFilterPatterns(
    @Body()
    body: {
      kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
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
        forcedLeverage: {
          type: 'number',
          nullable: true,
          description:
            'Принудительное плечо для сигналов из чата; null — выкл.; перекрывает плечо из сигнала и глобальные FORCED_*',
        },
        leverageRangeMode: {
          type: 'string',
          nullable: true,
          enum: ['min', 'max', 'mid'],
          description:
            'Режим выбора плеча из диапазона; null — наследовать глобальный LEVERAGE_RANGE_MODE',
        },
        minLeverage: {
          type: 'number',
          nullable: true,
          description:
            'Минимально допустимое плечо для чата; null — наследовать глобальный MIN_ALLOWED_LEVERAGE',
        },
        maxLeverage: {
          type: 'number',
          nullable: true,
          description:
            'Максимально допустимое плечо для чата; null — наследовать глобальный MAX_ALLOWED_LEVERAGE',
        },
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
        tpSlStepRange: {
          type: 'integer',
          nullable: true,
          description:
            'null — сбросить и наследовать глобальный TP_SL_STEP_RANGE; иначе 1..5 (шаг лестницы SL в TP)',
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
      forcedLeverage?: number | null;
      leverageRangeMode?: 'min' | 'max' | 'mid' | null;
      minLeverage?: number | null;
      maxLeverage?: number | null;
      defaultEntryUsd?: string | null;
      martingaleMultiplier?: number | null;
      sourcePriority?: number | null;
      minLotBump?: boolean | null;
      tpSlStepStart?: string | null;
      tpSlStepRange?: number | null;
    },
  ) {
    return this.userbot.updateChat(chatId, body);
  }
}
