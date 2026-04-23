import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
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
import { pickRequestedCabinetId } from '../../common/cabinet-request.util';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';

type AuthReq = {
  headers?: Record<string, string | string[] | undefined>;
  auth?: { userId?: string };
};

@ApiTags('Bybit')
@Controller('bybit')
export class BybitController {
  constructor(
    private readonly bybit: BybitService,
    private readonly balanceSnapshots: BalanceSnapshotService,
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

  @ApiOperation({ summary: 'Live-снимок экспозиции и ордеров Bybit' })
  @ApiOkResponse({ description: 'Снимок получен' })
  @Get('live')
  async live(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.bybit.getLiveExposureSnapshot());
  }

  /** Дневные снимки суммарного USDT в SQLite (cron), без запросов к Bybit. Дашборд: график. */
  @ApiOperation({ summary: 'История equity-снимков (локально из БД)' })
  @ApiQuery({ name: 'days', required: false, description: 'Количество дней' })
  @ApiOkResponse({ description: 'История баланса получена' })
  @Get('balance-history')
  async balanceHistory(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Query('days') days?: string,
  ) {
    const d = days != null ? Number.parseInt(String(days), 10) : 30;
    const points = await this.runWithCabinet(req, cabinetId, () =>
      this.balanceSnapshots.listRecent(Number.isFinite(d) ? d : 30),
    );
    return { points };
  }

  @ApiOperation({ summary: 'Отладочный снимок исполнения конкретной сделки' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Отладочные данные по сделке' })
  @Get('signal/:signalId')
  async signalSnapshot(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('signalId') signalId: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.bybit.getSignalExecutionDebugSnapshot(signalId),
    );
  }

  @ApiOperation({ summary: 'Детализация PnL/комиссий сделки из Bybit' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Детализация PnL получена' })
  @Get('trade-pnl-breakdown/:signalId')
  async tradePnlBreakdown(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('signalId') signalId: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.bybit.getTradePnlBreakdown(signalId),
    );
  }

  @ApiOperation({ summary: 'Ручное закрытие сделки на Bybit' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ description: 'Команда закрытия отправлена' })
  @Post('close/:signalId')
  async closeSignal(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('signalId') signalId: string,
    @Body() _body?: Record<string, unknown>,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.bybit.closeSignalManually(signalId),
    );
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
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body?: { limit?: number; dryRun?: boolean; async?: boolean },
  ) {
    return this.runWithCabinet(req, cabinetId, async () => {
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
    });
  }

  @ApiOperation({ summary: 'Статус async-job пересчёта closed PnL' })
  @ApiParam({ name: 'jobId', description: 'ID job' })
  @ApiOkResponse({ description: 'Статус job получен' })
  @Get('recalc-closed-pnl/:jobId')
  async recalcClosedPnlJobStatus(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('jobId') jobId: string,
  ) {
    return this.runWithCabinet(req, cabinetId, async () => {
      const status = await this.bybit.getRecalcClosedPnlJobStatus(jobId);
      if (!status) {
        return { ok: false, error: 'Job not found', jobId };
      }
      return { ok: true, ...status };
    });
  }
}
