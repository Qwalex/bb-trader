import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { BalanceSnapshotService } from './balance-snapshot.service';
import { BybitService } from './bybit.service';

@ApiTags('Bybit')
@Controller('bybit')
export class BybitController {
  constructor(
    private readonly bybit: BybitService,
    private readonly balanceSnapshots: BalanceSnapshotService,
  ) {}

  @Get('live')
  async live() {
    return this.bybit.getLiveExposureSnapshot();
  }

  /** Дневные снимки суммарного USDT в SQLite (cron), без запросов к Bybit. Дашборд: график. */
  @Get('balance-history')
  async balanceHistory(@Query('days') days?: string) {
    const d = days != null ? Number.parseInt(String(days), 10) : 30;
    const points = await this.balanceSnapshots.listRecent(Number.isFinite(d) ? d : 30);
    return { points };
  }

  @Get('signal/:signalId')
  async signalSnapshot(@Param('signalId') signalId: string) {
    return this.bybit.getSignalExecutionDebugSnapshot(signalId);
  }

  @Get('trade-pnl-breakdown/:signalId')
  async tradePnlBreakdown(@Param('signalId') signalId: string) {
    return this.bybit.getTradePnlBreakdown(signalId);
  }

  @Post('close/:signalId')
  async closeSignal(
    @Param('signalId') signalId: string,
    @Body() _body?: Record<string, unknown>,
  ) {
    return this.bybit.closeSignalManually(signalId);
  }

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

  @Get('recalc-closed-pnl/:jobId')
  async recalcClosedPnlJobStatus(@Param('jobId') jobId: string) {
    const status = this.bybit.getRecalcClosedPnlJobStatus(jobId);
    if (!status) {
      return { ok: false, error: 'Job not found', jobId };
    }
    return { ok: true, ...status };
  }
}
