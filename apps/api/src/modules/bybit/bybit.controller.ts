import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { BybitService } from './bybit.service';

@Controller('bybit')
export class BybitController {
  constructor(private readonly bybit: BybitService) {}

  @Get('live')
  async live() {
    return this.bybit.getLiveExposureSnapshot();
  }

  @Get('signal/:signalId')
  async signalSnapshot(@Param('signalId') signalId: string) {
    return this.bybit.getSignalExecutionDebugSnapshot(signalId);
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
    @Body() body?: { limit?: number; dryRun?: boolean },
  ) {
    return this.bybit.recalcClosedSignalsPnl({
      limit: body?.limit,
      dryRun: body?.dryRun ?? true,
    });
  }
}
