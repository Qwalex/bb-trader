import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
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

import { requireWorkspaceId } from '../../common/require-workspace-id';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import { OrdersService } from './orders.service';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @ApiOperation({ summary: 'Сводная статистика по сделкам' })
  @ApiQuery({ name: 'source', required: false, description: 'Фильтр по source' })
  @ApiOkResponse({ description: 'Статистика успешно получена' })
  @Get('stats')
  async stats(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Query('source') source?: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    const s = typeof source === 'string' ? source.trim() : '';
    return this.orders.getDashboardStats({
      source: s.length > 0 ? s : undefined,
      workspaceId,
    });
  }

  @ApiOperation({ summary: 'Серия PnL по дням или неделям' })
  @ApiQuery({ name: 'bucket', required: false, enum: ['day', 'week'] })
  @ApiQuery({ name: 'source', required: false })
  @ApiOkResponse({ description: 'Серия PnL успешно получена' })
  @Get('pnl-series')
  async pnlSeries(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Query('bucket') bucket?: string,
    @Query('source') source?: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    const b = bucket === 'week' ? 'week' : 'day';
    const s = typeof source === 'string' ? source.trim() : '';
    return this.orders.getPnlSeries(b, {
      source: s.length > 0 ? s : undefined,
      workspaceId,
    });
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
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
    const workspaceId = requireWorkspaceId(user);
    const truthy = (v: string | undefined) =>
      v === '1' || v?.toLowerCase() === 'true';
    const parsePositiveInt = (raw: string | undefined, fallback: number, max: number) => {
      if (!raw) return fallback;
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(Math.max(parsed, 1), max);
    };
    const parseDate = (raw: string | undefined) => {
      if (!raw) return undefined;
      const date = new Date(raw);
      return Number.isNaN(date.getTime()) ? undefined : date;
    };
    const parsedPage = parsePositiveInt(page, 1, 10_000);
    const parsedPageSize = parsePositiveInt(pageSize, 20, 100);
    const refreshPnlFromExchange = truthy(refreshPnl);
    const includeMartingaleSteps = truthy(martingaleSteps);
    if ((refreshPnlFromExchange || includeMartingaleSteps) && parsedPageSize > 50) {
      throw new BadRequestException(
        'Для тяжёлых режимов refreshPnl/martingaleSteps pageSize не должен превышать 50',
      );
    }
    return this.orders.listTrades({
      workspaceId,
      signalId,
      source,
      pair,
      status,
      from: parseDate(from),
      to: parseDate(to),
      includeDeleted: includeDeleted === '1' || includeDeleted === 'true',
      sortBy: sortBy === 'closedAt' ? 'closedAt' : 'createdAt',
      page: parsedPage,
      pageSize: parsedPageSize,
      refreshPnlFromExchange,
      includeMartingaleSteps,
    });
  }

  @ApiOperation({ summary: 'Удалить одну сделку (soft delete)' })
  @ApiParam({ name: 'id', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Сделка удалена' })
  @Delete('trades/:id')
  async deleteTrade(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
  ) {
    await this.orders.deleteTrade(id, { workspaceId: requireWorkspaceId(user) });
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body?: { confirm?: boolean },
  ) {
    if (body?.confirm !== true) {
      throw new BadRequestException('Укажите { "confirm": true } для удаления всех сделок');
    }
    return this.orders.deleteAllTradesSequential(requireWorkspaceId(user));
  }

  @ApiOperation({ summary: 'Восстановить удалённую сделку' })
  @ApiParam({ name: 'id', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Сделка восстановлена' })
  @Post('trades/:id/restore')
  async restoreTrade(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
  ) {
    await this.orders.restoreTrade(id, requireWorkspaceId(user));
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
    @Body() body: { source?: string | null },
  ) {
    return this.orders.updateSignalSourceWithPropagation(
      id,
      body.source === undefined ? null : body.source,
      requireWorkspaceId(user),
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
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
    return this.orders.updateTradeTelegramSource(id, {
      sourceChatId: body.sourceChatId,
      sourceMessageId: body.sourceMessageId,
    }, requireWorkspaceId(user));
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
    @Body() body: { realizedPnl?: number | null },
  ) {
    const raw = body.realizedPnl;
    const pnl = raw === undefined || raw === null ? null : Number(raw);
    if (pnl !== null && !Number.isFinite(pnl)) {
      throw new BadRequestException('realizedPnl должен быть числом или null');
    }
    return this.orders.updateTradePnlManual(id, pnl, requireWorkspaceId(user));
  }

  @ApiOperation({ summary: 'Группировка статистики по source' })
  @ApiOkResponse({ description: 'Статистика по source' })
  @Get('by-source')
  async bySource(@CurrentUser() user: AuthenticatedRequestContext | null) {
    return this.orders.statsBySource(requireWorkspaceId(user));
  }

  @ApiOperation({ summary: 'Топ источников по метрикам' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiOkResponse({ description: 'Топ источников получен' })
  @Get('top-sources')
  async topSources(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Query('limit') limit?: string,
  ) {
    const workspaceId = requireWorkspaceId(user);
    const raw = limit ? Number(limit) : 5;
    const take = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 5;
    return this.orders.getTopSources({ limit: take, workspaceId });
  }

  @ApiOperation({ summary: 'Список уникальных source' })
  @ApiOkResponse({ description: 'Список source' })
  @Get('sources')
  async sources(@CurrentUser() user: AuthenticatedRequestContext | null) {
    return this.orders.listDistinctSources(requireWorkspaceId(user));
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body?: { confirm?: boolean },
  ) {
    if (body?.confirm !== true) {
      throw new BadRequestException('Укажите { "confirm": true } для сброса статистики');
    }
    if (user?.appRole !== 'admin') {
      throw new ForbiddenException('Только администратор приложения может сбросить статистику');
    }
    return this.orders.resetAnalyticsStats(requireWorkspaceId(user));
  }

  @ApiOperation({ summary: 'Группировка статистики по торговым парам' })
  @ApiOkResponse({ description: 'Статистика по парам' })
  @Get('by-pair')
  async byPair(@CurrentUser() user: AuthenticatedRequestContext | null) {
    return this.orders.statsByPair(requireWorkspaceId(user));
  }
}
