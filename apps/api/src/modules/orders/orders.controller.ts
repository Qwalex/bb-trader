import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { OrdersService } from './orders.service';
import { pickRequestedCabinetId } from '../../common/cabinet-request.util';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';

type AuthReq = {
  headers?: Record<string, string | string[] | undefined>;
  auth?: { userId?: string };
};

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
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
    return this.cabinetContext.runWithCabinet(cabinetId, fn);
  }

  @ApiOperation({ summary: 'Сводная статистика по сделкам' })
  @ApiQuery({ name: 'source', required: false, description: 'Фильтр по source' })
  @ApiOkResponse({ description: 'Статистика успешно получена' })
  @Get('stats')
  async stats(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Query('source') source?: string,
  ) {
    const s = typeof source === 'string' ? source.trim() : '';
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.getDashboardStats({ source: s.length > 0 ? s : undefined }),
    );
  }

  @ApiOperation({ summary: 'Серия PnL по дням или неделям' })
  @ApiQuery({ name: 'bucket', required: false, enum: ['day', 'week'] })
  @ApiQuery({ name: 'source', required: false })
  @ApiOkResponse({ description: 'Серия PnL успешно получена' })
  @Get('pnl-series')
  async pnlSeries(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Query('bucket') bucket?: string,
    @Query('source') source?: string,
  ) {
    const b = bucket === 'week' ? 'week' : 'day';
    const s = typeof source === 'string' ? source.trim() : '';
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.getPnlSeries(b, { source: s.length > 0 ? s : undefined }),
    );
  }

  @ApiOperation({ summary: 'Список сделок с фильтрами и пагинацией' })
  @ApiQuery({ name: 'signalId', required: false })
  @ApiQuery({ name: 'source', required: false })
  @ApiQuery({ name: 'pair', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO date' })
  @ApiQuery({ name: 'includeDeleted', required: false })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['createdAt', 'closedAt'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiQuery({
    name: 'refreshPnl',
    required: false,
    description:
      '1/true — для закрытых сделок запросить PnL с Bybit (медленно); по умолчанию только БД',
  })
  @ApiQuery({
    name: 'martingaleSteps',
    required: false,
    description:
      '1/true — посчитать шаг мартингейла (тяжёлый запрос по истории источника)',
  })
  @ApiOkResponse({ description: 'Список сделок успешно получен' })
  @Get('trades')
  async trades(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Query('signalId') signalId?: string,
    @Query('source') source?: string,
    @Query('pair') pair?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includeDeleted') includeDeleted?: string,
    @Query('sortBy') sortBy?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('refreshPnl') refreshPnl?: string,
    @Query('martingaleSteps') martingaleSteps?: string,
  ) {
    const truthy = (v: string | undefined) =>
      v === '1' || v?.toLowerCase() === 'true';
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.listTrades({
        signalId,
        source,
        pair,
        status,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        includeDeleted: includeDeleted === '1' || includeDeleted === 'true',
        sortBy: sortBy === 'closedAt' ? 'closedAt' : 'createdAt',
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 20,
        refreshPnlFromExchange: truthy(refreshPnl),
        includeMartingaleSteps: truthy(martingaleSteps),
      }),
    );
  }

  @ApiOperation({ summary: 'Удалить одну сделку (soft delete)' })
  @ApiParam({ name: 'id', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Сделка удалена' })
  @Delete('trades/:id')
  async deleteTrade(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
  ) {
    await this.runWithCabinet(req, cabinetId, () => this.orders.deleteTrade(id));
    return { ok: true };
  }

  @ApiOperation({ summary: 'Удалить все сделки (последовательно)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', example: true } },
    },
  })
  @ApiBadRequestResponse({ description: 'Не передано confirm=true' })
  @ApiOkResponse({ description: 'Удаление всех сделок выполнено' })
  @Post('trades/delete-all')
  async deleteAllTrades(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body?: { confirm?: boolean },
  ) {
    if (body?.confirm !== true) {
      throw new BadRequestException('Укажите { "confirm": true } для удаления всех сделок');
    }
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.deleteAllTradesSequential(),
    );
  }

  @ApiOperation({ summary: 'Восстановить удалённую сделку' })
  @ApiParam({ name: 'id', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Сделка восстановлена' })
  @Post('trades/:id/restore')
  async restoreTrade(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
  ) {
    await this.runWithCabinet(req, cabinetId, () => this.orders.restoreTrade(id));
    return { ok: true };
  }

  @ApiOperation({ summary: 'Обновить source сделки' })
  @ApiParam({ name: 'id', description: 'ID сделки' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { source: { type: 'string', nullable: true } },
    },
  })
  @ApiOkResponse({ description: 'Source обновлён' })
  @Patch('trades/:id/source')
  async updateTradeSource(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Body() body: { source?: string | null },
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.updateSignalSourceWithPropagation(
        id,
        body.source === undefined ? null : body.source,
      ),
    );
  }

  @ApiOperation({ summary: 'Обновить Telegram-привязку сделки' })
  @ApiParam({ name: 'id', description: 'ID сделки' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['sourceChatId', 'sourceMessageId'],
      properties: {
        sourceChatId: { type: 'string', nullable: true },
        sourceMessageId: { type: 'string', nullable: true },
      },
    },
  })
  @ApiBadRequestResponse({ description: 'Невалидное тело запроса' })
  @ApiOkResponse({ description: 'Telegram-привязка обновлена' })
  @Patch('trades/:id/telegram-source')
  async updateTradeTelegramSource(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Body()
    body: {
      sourceChatId?: string | null;
      sourceMessageId?: string | null;
    },
  ) {
    if (body.sourceChatId === undefined || body.sourceMessageId === undefined) {
      throw new BadRequestException(
        'Укажите sourceChatId и sourceMessageId (строки или null для сброса)',
      );
    }
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.updateTradeTelegramSource(id, {
        sourceChatId: body.sourceChatId ?? null,
        sourceMessageId: body.sourceMessageId ?? null,
      }),
    );
  }

  @ApiOperation({ summary: 'Ручная корректировка realized PnL' })
  @ApiParam({ name: 'id', description: 'ID сделки' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { realizedPnl: { type: 'number', nullable: true } },
    },
  })
  @ApiBadRequestResponse({ description: 'realizedPnl не число' })
  @ApiOkResponse({ description: 'PnL обновлён' })
  @Patch('trades/:id/pnl')
  async updateTradePnl(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Body() body: { realizedPnl?: number | null },
  ) {
    const raw = body.realizedPnl;
    const pnl = raw === undefined || raw === null ? null : Number(raw);
    if (pnl !== null && !Number.isFinite(pnl)) {
      throw new BadRequestException('realizedPnl должен быть числом или null');
    }
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.updateTradePnlManual(id, pnl),
    );
  }

  @ApiOperation({ summary: 'Группировка статистики по source' })
  @ApiOkResponse({ description: 'Статистика по source' })
  @Get('by-source')
  async bySource(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.orders.statsBySource());
  }

  @ApiOperation({ summary: 'Топ источников по метрикам' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Топ источников получен' })
  @Get('top-sources')
  async topSources(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Query('limit') limit?: string,
  ) {
    const raw = limit ? Number(limit) : 5;
    const take = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 5;
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.getTopSources({ limit: take }),
    );
  }

  @ApiOperation({ summary: 'Список уникальных source' })
  @ApiOkResponse({ description: 'Список source' })
  @Get('sources')
  async sources(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.orders.listDistinctSources(),
    );
  }

  @ApiOperation({ summary: 'Сброс статистики аналитики' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', example: true } },
    },
  })
  @ApiBadRequestResponse({ description: 'Не передано confirm=true' })
  @ApiOkResponse({ description: 'Статистика сброшена' })
  @Post('reset-stats')
  async resetStats(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body?: { confirm?: boolean },
  ) {
    if (body?.confirm !== true) {
      throw new BadRequestException('Укажите { "confirm": true } для сброса статистики');
    }
    return this.runWithCabinet(req, cabinetId, () => this.orders.resetAnalyticsStats());
  }

  @ApiOperation({ summary: 'Группировка статистики по торговым парам' })
  @ApiOkResponse({ description: 'Статистика по парам' })
  @Get('by-pair')
  async byPair(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.orders.statsByPair());
  }
}
