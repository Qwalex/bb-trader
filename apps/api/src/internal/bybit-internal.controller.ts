import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/public.decorator';
import { pickRequestedCabinetId } from '../common/cabinet-request.util';
import { isDedicatedWorkerBybitProcessRole } from '../config/process-role.util';
import { InternalServiceGuard } from './internal-service.guard';
import { BalanceSnapshotService } from '../modules/bybit/balance-snapshot.service';
import { BybitService } from '../modules/bybit/bybit.service';
import { BybitSpotService } from '../modules/bybit-spot/bybit-spot.service';
import { BybitStuckTradesService } from '../modules/bybit/exposure/bybit-stuck-trades.service';
import { CabinetContextService } from '../modules/cabinet/cabinet-context.service';
import { CabinetService } from '../modules/cabinet/cabinet.service';

type InternalReq = {
  headers?: Record<string, string | string[] | undefined>;
};

@ApiTags('Internal Bybit')
@Controller('internal/bybit')
@Public()
@UseGuards(InternalServiceGuard)
export class BybitInternalController {
  constructor(
    private readonly bybit: BybitService,
    private readonly bybitSpot: BybitSpotService,
    private readonly stuckTradesService: BybitStuckTradesService,
    private readonly balanceSnapshots: BalanceSnapshotService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private ensureRole(): void {
    if (!isDedicatedWorkerBybitProcessRole()) {
      throw new Error('Internal Bybit routes are only served on worker-bybit role');
    }
  }

  private async runWithCabinet<T>(
    req: InternalReq,
    queryCabinetId: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    this.ensureRole();
    const requested = pickRequestedCabinetId({
      queryCabinetId,
      headers: req.headers,
    });
    const cabinetId = await this.cabinets.resolveCabinetIdForUser(null, requested);
    return this.cabinetContext.runWithCabinetAsync(cabinetId, fn);
  }

  @Get('live')
  @ApiOperation({ summary: 'Internal: live exposure snapshot' })
  @ApiOkResponse({ description: 'OK' })
  live(@Req() req: InternalReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, () => this.bybit.getLiveExposureSnapshot());
  }

  @Get('unified-balance')
  unifiedBalance(@Req() req: InternalReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, async () => {
      const details = await this.bybit.getUnifiedUsdtBalanceDetails();
      if (!details) {
        return { ok: false };
      }
      return { ok: true, ...details };
    });
  }

  @Get('stuck-trades')
  stuckTrades(@Req() req: InternalReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.stuckTradesService.getStuckTradesSnapshot(),
    );
  }

  @Get('balance-history')
  balanceHistory(
    @Req() req: InternalReq,
    @Query('cabinetId') cabinetId?: string,
    @Query('days') days?: string,
  ) {
    const d = days != null ? Number.parseInt(String(days), 10) : 30;
    return this.runWithCabinet(req, cabinetId, async () => ({
      points: await this.balanceSnapshots.listRecent(Number.isFinite(d) ? d : 30),
    }));
  }

  @Get('signal/:signalId')
  signalSnapshot(
    @Req() req: InternalReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('signalId') signalId: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.bybit.getSignalExecutionDebugSnapshot(signalId),
    );
  }

  @Get('trade-pnl-breakdown/:signalId')
  tradePnlBreakdown(
    @Req() req: InternalReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('signalId') signalId: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.bybit.getTradePnlBreakdown(signalId));
  }

  @Post('apply-tpsl/:signalId')
  applyTpSl(
    @Req() req: InternalReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('signalId') signalId: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.bybit.applyTpSlManually(signalId));
  }

  @Post('close/:signalId')
  closeSignal(
    @Req() req: InternalReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('signalId') signalId: string,
  ) {
    return this.runWithCabinet(req, cabinetId, () => this.bybit.closeSignalManually(signalId));
  }

  @Post('recalc-closed-pnl')
  recalcClosedPnlAsync(
    @Req() req: InternalReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body?: { limit?: number; dryRun?: boolean },
  ) {
    return this.runWithCabinet(req, cabinetId, async () =>
      this.bybit.startRecalcClosedSignalsPnlJob({
        limit: body?.limit,
        dryRun: body?.dryRun ?? true,
      }),
    );
  }

  @Post('recalc-closed-pnl-sync')
  recalcClosedPnlSync(
    @Req() req: InternalReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body?: { limit?: number; dryRun?: boolean },
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.bybit.recalcClosedSignalsPnl({
        limit: body?.limit,
        dryRun: body?.dryRun ?? true,
      }),
    );
  }

  @Get('recalc-closed-pnl/:jobId')
  recalcJobStatus(
    @Req() req: InternalReq,
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

  @Post('place-userbot-signal')
  placeUserbotSignal(
    @Req() req: InternalReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body: unknown,
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.bybitSpot.routeUserbotSignalPlacement(body as Parameters<
        BybitSpotService['routeUserbotSignalPlacement']
      >[0]),
    );
  }
}
