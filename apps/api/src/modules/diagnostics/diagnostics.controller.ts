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
  @Post('run-latest')
  async runLatest(@Body() body?: { limit?: number }) {
    return this.diagnostics.runLatestBatch({ limit: body?.limit });
  }

  @ApiOperation({ summary: 'Список запусков диагностики' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiForbiddenResponse({ description: 'Запрос не того origin' })
  @ApiOkResponse({ description: 'Список запусков получен' })
  @Get('runs')
  async runs(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : undefined;
    return this.diagnostics.listRuns(Number.isFinite(parsed) ? parsed : undefined);
  }

  @ApiOperation({ summary: 'Детали запуска диагностики' })
  @ApiParam({ name: 'id', description: 'ID запуска' })
  @ApiForbiddenResponse({ description: 'Запрос не того origin' })
  @ApiOkResponse({ description: 'Детали запуска получены' })
  @Get('runs/:id')
  async runDetails(@Param('id') id: string) {
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
  @Post('trading-advice')
  async tradingAdvice(@Body() body?: { closedLimit?: number }) {
    return this.tradingAdvisor.generateAdvice({
      closedLimit: body?.closedLimit,
    });
  }
}
