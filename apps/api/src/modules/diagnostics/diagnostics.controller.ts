import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBody,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { requireWorkspaceId } from '../../common/require-workspace-id';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import { DiagnosticsService } from './diagnostics.service';
import { TradingAiAdvisorService } from './trading-ai-advisor.service';

@ApiTags('Diagnostics')
@Controller('diagnostics')
export class DiagnosticsController {
  constructor(
    private readonly diagnostics: DiagnosticsService,
    private readonly tradingAdvisor: TradingAiAdvisorService,
  ) {}

  @ApiOperation({ summary: 'Запустить диагностику по последним кейсам' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { limit: { type: 'number' } },
    },
  })
  @ApiForbiddenResponse({ description: 'Запрос не того origin' })
  @ApiOkResponse({ description: 'Диагностика запущена' })
  @Throttle({ heavy: { limit: 10, ttl: 60_000 } })
  @Post('run-latest')
  async runLatest(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body?: { limit?: number },
  ) {
    requireWorkspaceId(user);
    return this.diagnostics.runLatestBatch({ limit: body?.limit });
  }

  @ApiOperation({ summary: 'Список запусков диагностики' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiForbiddenResponse({ description: 'Запрос не того origin' })
  @ApiOkResponse({ description: 'Список запусков получен' })
  @Get('runs')
  async runs(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Query('limit') limit?: string,
  ) {
    requireWorkspaceId(user);
    const parsed = limit ? Number(limit) : undefined;
    return this.diagnostics.listRuns(Number.isFinite(parsed) ? parsed : undefined);
  }

  @ApiOperation({ summary: 'Детали запуска диагностики' })
  @ApiParam({ name: 'id', description: 'ID запуска' })
  @ApiForbiddenResponse({ description: 'Запрос не того origin' })
  @ApiOkResponse({ description: 'Детали запуска получены' })
  @Get('runs/:id')
  async runDetails(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
  ) {
    requireWorkspaceId(user);
    return this.diagnostics.getRunDetails(id);
  }

  @ApiOperation({ summary: 'Сгенерировать торговые рекомендации' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { closedLimit: { type: 'number' } },
    },
  })
  @ApiForbiddenResponse({ description: 'Запрос не того origin' })
  @ApiOkResponse({ description: 'Рекомендации сгенерированы' })
  @Throttle({ heavy: { limit: 10, ttl: 60_000 } })
  @Post('trading-advice')
  async tradingAdvice(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body?: { closedLimit?: number },
  ) {
    requireWorkspaceId(user);
    return this.tradingAdvisor.generateAdvice({
      closedLimit: body?.closedLimit,
    });
  }
}
