import { Body, Controller, ForbiddenException, Get, Param, Post, Query } from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import { BalanceSnapshotService } from './balance-snapshot.service';
import { BybitService } from './bybit.service';

@ApiTags('Bybit')
@Controller('bybit')
export class BybitController {
  constructor(
    private readonly bybit: BybitService,
    private readonly balanceSnapshots: BalanceSnapshotService,
  ) {}

  private requireWorkspaceId(user: AuthenticatedRequestContext | null): string {
    const workspaceId = user?.workspaceId?.trim();
    if (!workspaceId) {
      throw new ForbiddenException('Workspace context is required');
    }
    return workspaceId;
  }

  @ApiOperation({ summary: 'Live-снимок экспозиции и ордеров Bybit' })
  @ApiOkResponse({ description: 'Снимок получен' })
  @Get('live')
  async live(@CurrentUser() user: AuthenticatedRequestContext | null) {
    return this.bybit.getLiveExposureSnapshot(this.requireWorkspaceId(user));
  }

  /** Дневные снимки суммарного USDT в БД (cron), без запросов к Bybit. Дашборд: график. */
  @ApiOperation({ summary: 'История equity-снимков (локально из БД)' })
  @ApiQuery({ name: 'days', required: false, description: 'Количество дней' })
  @ApiOkResponse({ description: 'История баланса получена' })
  @Get('balance-history')
  async balanceHistory(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Query('days') days?: string,
  ) {
    const workspaceId = this.requireWorkspaceId(user);
    const d = days != null ? Number.parseInt(String(days), 10) : 30;
    const points = await this.balanceSnapshots.listRecent(
      Number.isFinite(d) ? d : 30,
      workspaceId,
    );
    return { points };
  }

  @ApiOperation({ summary: 'Отладочный снимок исполнения конкретной сделки' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Отладочные данные по сделке' })
  @Get('signal/:signalId')
  async signalSnapshot(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('signalId') signalId: string,
  ) {
    return this.bybit.getSignalExecutionDebugSnapshot(signalId, this.requireWorkspaceId(user));
  }

  @ApiOperation({ summary: 'Детализация PnL/комиссий сделки из Bybit' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiOkResponse({ description: 'Детализация PnL получена' })
  @Get('trade-pnl-breakdown/:signalId')
  async tradePnlBreakdown(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('signalId') signalId: string,
  ) {
    return this.bybit.getTradePnlBreakdown(signalId, this.requireWorkspaceId(user));
  }

  @ApiOperation({ summary: 'Ручное закрытие сделки на Bybit' })
  @ApiParam({ name: 'signalId', description: 'ID сделки' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiOkResponse({ description: 'Команда закрытия отправлена' })
  @Post('close/:signalId')
  async closeSignal(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('signalId') signalId: string,
    @Body() _body?: Record<string, unknown>,
  ) {
    return this.bybit.closeSignalManually(signalId, this.requireWorkspaceId(user));
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
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body?: { limit?: number; dryRun?: boolean; async?: boolean },
  ) {
    const workspaceId = this.requireWorkspaceId(user);
    if (body?.async !== false) {
      return this.bybit.startRecalcClosedSignalsPnlJob({
        limit: body?.limit,
        dryRun: body?.dryRun ?? true,
        workspaceId,
      });
    }
    return this.bybit.recalcClosedSignalsPnl({
      limit: body?.limit,
      dryRun: body?.dryRun ?? true,
      workspaceId,
    });
  }

  @ApiOperation({ summary: 'Статус async-job пересчёта closed PnL' })
  @ApiParam({ name: 'jobId', description: 'ID job' })
  @ApiOkResponse({ description: 'Статус job получен' })
  @Get('recalc-closed-pnl/:jobId')
  async recalcClosedPnlJobStatus(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('jobId') jobId: string,
  ) {
    const status = this.bybit.getRecalcClosedPnlJobStatus(jobId, this.requireWorkspaceId(user));
    if (!status) {
      return { ok: false, error: 'Job not found', jobId };
    }
    return { ok: true, ...status };
  }
}
