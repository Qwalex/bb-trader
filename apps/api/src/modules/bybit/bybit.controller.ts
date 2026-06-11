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
import { BybitInternalClientService } from './bybit-internal-client.service';
import { BybitStuckTradesService } from './exposure/bybit-stuck-trades.service';
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
    private readonly bybitInternal: BybitInternalClientService,
    private readonly stuckTradesService: BybitStuckTradesService,
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

  private cabinetIdForProxy(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  @ApiOperation({ summary: 'Live-снимок экспозиции и ордеров Bybit' })
  @ApiOkResponse({ description: 'Снимок получен' })
  @Get('live')
  async live(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId?: string,
  ) {
    if (this.bybitInternal.isEnabled()) {
      return this.runWithCabinet(req, cabinetId, () =>
        this.bybitInternal.getLiveExposureSnapshot(this.cabinetIdForProxy()),
      );
    }
    return this.runWithCabinet(req, cabinetId, () => this.bybit.getLiveExposureSnapshot());
  }

  @ApiOperation({ summary: 'Зависшие сделки — расхождение БД/биржа, нет TP/SL, зависший poll' })
  @ApiOkResponse({ description: 'Список проблемных активных сделок' })
  @Get('stuck-trades')
  async stuckTrades(@Req() req: AuthReq, @Query('cabinetId') cabinetId?: string) {
    if (this.bybitInternal.isEnabled()) {
      return this.runWithCabinet(req, cabinetId, () =>
        this.bybitInternal.getStuckTradesSnapshot(this.cabinetIdForProxy()),
      );
    }
    return this.runWithCabinet(req, cabinetId, () =>
      this.stuckTradesService.getStuckTradesSnapshot(),
    );
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
    if (this.bybitInternal.isEnabled()) {
      return this.runWithCabinet(req, cabinetId, () =>
        this.bybitInternal.getSignalExecutionDebugSnapshot(
          signalId,
          this.cabinetIdForProxy(),
        ),
      );
    }
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
    if (this.bybitInternal.isEnabled()) {
      return this.runWithCabinet(req, cabinetId, () =>
        this.bybitInternal.getTradePnlBreakdown(signalId, this.cabinetIdForProxy()),
      );
    }
    return this.runWithCabinet(req, cabinetId, () =>
      this.bybit.getTradePnlBreakdown(signalId),
    );
  }

  @ApiOperation({ summary: 'Синхронизация с Bybit и ручная постановка TP/SL для активной сделки' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiOkResponse({ description: 'TP/SL применены или частично применены' })
  @Post('apply-tpsl/:signalId')
  async applyTpSl(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('signalId') signalId: string,
  ) {
    if (this.bybitInternal.isEnabled()) {
      return this.runWithCabinet(req, cabinetId, () =>
        this.bybitInternal.applyTpSlManually(signalId, this.cabinetIdForProxy()),
      );
    }
    return this.runWithCabinet(req, cabinetId, () => this.bybit.applyTpSlManually(signalId));
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
    if (this.bybitInternal.isEnabled()) {
      return this.runWithCabinet(req, cabinetId, () =>
        this.bybitInternal.closeSignalManually(signalId, this.cabinetIdForProxy()),
      );
    }
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
      const cid = this.cabinetIdForProxy();
      if (this.bybitInternal.isEnabled()) {
        if (body?.async !== false) {
          return this.bybitInternal.startRecalcClosedSignalsPnl(
            { limit: body?.limit, dryRun: body?.dryRun ?? true },
            cid,
          );
        }
        return this.bybitInternal.recalcClosedSignalsPnl(
          { limit: body?.limit, dryRun: body?.dryRun ?? true },
          cid,
        );
      }
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
    if (this.bybitInternal.isEnabled()) {
      return this.runWithCabinet(req, cabinetId, () =>
        this.bybitInternal.getRecalcClosedPnlJobStatus(jobId, this.cabinetIdForProxy()),
      );
    }
    return this.runWithCabinet(req, cabinetId, async () => {
      const status = await this.bybit.getRecalcClosedPnlJobStatus(jobId);
      if (!status) {
        return { ok: false, error: 'Job not found', jobId };
      }
      return { ok: true, ...status };
    });
  }
}
