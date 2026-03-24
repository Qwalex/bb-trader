import { Controller, Delete, Get, Param, Query } from '@nestjs/common';

import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('stats')
  async stats() {
    return this.orders.getDashboardStats();
  }

  @Get('pnl-series')
  async pnlSeries(@Query('bucket') bucket?: string) {
    const b = bucket === 'week' ? 'week' : 'day';
    return this.orders.getPnlSeries(b);
  }

  @Get('trades')
  async trades(
    @Query('source') source?: string,
    @Query('pair') pair?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.orders.listTrades({
      source,
      pair,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page: page ? parseInt(page, 10) : 1,
      pageSize: pageSize ? parseInt(pageSize, 10) : 20,
    });
  }

  @Delete('trades/:id')
  async deleteTrade(@Param('id') id: string) {
    await this.orders.deleteTrade(id);
    return { ok: true };
  }

  @Get('by-source')
  async bySource() {
    return this.orders.statsBySource();
  }

  @Get('by-pair')
  async byPair() {
    return this.orders.statsByPair();
  }
}
