import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { BalanceSnapshotService } from './balance-snapshot.service';
import { BybitService } from './bybit.service';

@ApiTags('Bybit')
@Controller('bybit')
export class BybitController {
  constructor(
    private readonly bybit: BybitService,
    private readonly balanceSnapshots: BalanceSnapshotService,
  ) {}

  @ApiOperation({ summary: 'Live-снимок экспозиции и ордеров Bybit' })
  @ApiOkResponse({ description: 'Снимок получен' })
  @Get('live')
  async live() {
    return this.bybit.getLiveExposureSnapshot();
  }

  /** Дневные снимки суммарного USDT в SQLite (cron), без запросов к Bybit. Дашборд: график. */
  @ApiOperation({ summary: 'История equity-снимков (локально из БД)' })
  @ApiQuery({ name: 'days', required: false, description: 'Количество дней' })
  @ApiOkResponse({ description: 'История баланса получена' })
  @Get('balance-history')
  async balanceHistory(@Query('days') days?: string) {
    const d = days != null ? Number.parseInt(String(days), 10) : 30;
    const points = await this.balanceSnapshots.listRecent(Number.isFinite(d) ? d : 30);
    return { points };
  }

  @ApiOperation({ summary: 'Отладочный снимок исполнения конкретной сделки' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Отладочные данные по сделке' })
  @Get('signal/:signalId')
  async signalSnapshot(@Param('signalId') signalId: string) {
    return this.bybit.getSignalExecutionDebugSnapshot(signalId);
  }

  @ApiOperation({ summary: 'Детализация PnL/комиссий сделки из Bybit' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Детализация PnL получена' })
  @Get('trade-pnl-breakdown/:signalId')
  async tradePnlBreakdown(@Param('signalId') signalId: string) {
    return this.bybit.getTradePnlBreakdown(signalId);
  }

  @ApiOperation({ summary: 'Ручное закрытие сделки на Bybit' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ description: 'Команда закрытия отправлена' })
  @Post('close/:signalId')
  async closeSignal(
    @Param('signalId') signalId: string,
    @Body() _body?: Record<string, unknown>,
  ) {
    return this.bybit.closeSignalManually(signalId);
  }

  @ApiOperation({ summary: 'Пересчёт closed PnL (sync/async)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        limit: { type: 'number' },
        dryRun: { type: 'boolean' },
        async: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ description: 'Пересчёт запущен или выполнен' })
  @Post('recalc-closed-pnl')
  async recalcClosedPnl(
    @Body() body?: { limit?: number; dryRun?: boolean; async?: boolean },
  ) {
    if (body?.async !== false) {
      return this.bybit.startRecalcClosedSignalsPnlJob({
        limit: body?.limit,
        dryRun: body?.dryRun ?? true,
      });
    }
    return this.bybit.recalcClosedSignalsPnl({
      limit: body?.limit,
      dryRun: body?.dryRun ?? true,
    });
  }

  @ApiOperation({ summary: 'Статус async-job пересчёта closed PnL' })
  @ApiParam({ name: 'jobId', description: 'ID job' })
  @ApiOkResponse({ description: 'Статус job получен' })
  @Get('recalc-closed-pnl/:jobId')
  async recalcClosedPnlJobStatus(@Param('jobId') jobId: string) {
    const status = await this.bybit.getRecalcClosedPnlJobStatus(jobId);
    if (!status) {
      return { ok: false, error: 'Job not found', jobId };
    }
    return { ok: true, ...status };
  }
}
