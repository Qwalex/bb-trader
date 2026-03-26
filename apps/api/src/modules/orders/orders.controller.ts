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
} from '@nestjs/common';

import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('stats')
  async stats(@Query('source') source?: string) {
    const s = typeof source === 'string' ? source.trim() : '';
    return this.orders.getDashboardStats({ source: s.length > 0 ? s : undefined });
  }

  @Get('pnl-series')
  async pnlSeries(@Query('bucket') bucket?: string, @Query('source') source?: string) {
    const b = bucket === 'week' ? 'week' : 'day';
    const s = typeof source === 'string' ? source.trim() : '';
    return this.orders.getPnlSeries(b, { source: s.length > 0 ? s : undefined });
  }

  @Get('trades')
  async trades(
    @Query('source') source?: string,
    @Query('pair') pair?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('includeDeleted') includeDeleted?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orders.listTrades({
      source,
      pair,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      includeDeleted: includeDeleted === '1' || includeDeleted === 'true',
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  @Delete('trades/:id')
  async deleteTrade(@Param('id') id: string) {
    await this.orders.deleteTrade(id);
    return { ok: true };
  }

  @Post('trades/:id/restore')
  async restoreTrade(@Param('id') id: string) {
    await this.orders.restoreTrade(id);
    return { ok: true };
  }

  @Patch('trades/:id/source')
  async updateTradeSource(
    @Param('id') id: string,
    @Body() body: { source?: string | null },
  ) {
    return this.orders.updateSignalSourceWithPropagation(
      id,
      body.source === undefined ? null : body.source,
    );
  }

  @Patch('trades/:id/pnl')
  async updateTradePnl(
    @Param('id') id: string,
    @Body() body: { realizedPnl?: number | null },
  ) {
    const raw = body.realizedPnl;
    const pnl = raw === undefined || raw === null ? null : Number(raw);
    if (pnl !== null && !Number.isFinite(pnl)) {
      throw new BadRequestException('realizedPnl должен быть числом или null');
    }
    return this.orders.updateTradePnlManual(id, pnl);
  }

  @Get('by-source')
  async bySource() {
    return this.orders.statsBySource();
  }

  @Get('top-sources')
  async topSources(@Query('limit') limit?: string) {
    const raw = limit ? Number(limit) : 5;
    const take = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 5;
    return this.orders.getTopSources({ limit: take });
  }

  @Get('sources')
  async sources() {
    return this.orders.listDistinctSources();
  }

  @Get('by-pair')
  async byPair() {
    return this.orders.statsByPair();
  }
}
