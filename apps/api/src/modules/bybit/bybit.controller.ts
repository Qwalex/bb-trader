import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { BybitService } from './bybit.service';

@Controller('bybit')
export class BybitController {
  constructor(private readonly bybit: BybitService) {}

  @Get('live')
  async live() {
    return this.bybit.getLiveExposureSnapshot();
  }

  @Post('close/:signalId')
  async closeSignal(
    @Param('signalId') signalId: string,
    @Body() _body?: Record<string, unknown>,
  ) {
    return this.bybit.closeSignalManually(signalId);
  }
}
