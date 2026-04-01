import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
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

  private assertSameOriginBrowserRequest(
    hostHeader?: string,
    originHeader?: string,
    refererHeader?: string,
    secFetchSiteHeader?: string,
  ) {
    const secFetchSite = String(secFetchSiteHeader ?? '').trim().toLowerCase();
    if (
      secFetchSite === 'same-origin' ||
      secFetchSite === 'same-site' ||
      secFetchSite === 'none'
    ) {
      return;
    }

    const host = String(hostHeader ?? '').trim().toLowerCase();
    if (!host) {
      throw new ForbiddenException('Diagnostics API: missing host header');
    }

    const expectedHost = host.split(',')[0]?.trim() ?? host;
    const parseHost = (value?: string): string | null => {
      const raw = String(value ?? '').trim();
      if (!raw) return null;
      try {
        return new URL(raw).host.toLowerCase();
      } catch {
        return null;
      }
    };

    const originHost = parseHost(originHeader);
    const refererHost = parseHost(refererHeader);
    const sameOrigin =
      (originHost != null && originHost === expectedHost) ||
      (refererHost != null && refererHost === expectedHost);

    if (!sameOrigin) {
      throw new ForbiddenException(
        'Diagnostics API доступен только из встроенного web-интерфейса того же origin',
      );
    }
  }

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
  async runLatest(
    @Body() body?: { limit?: number },
    @Headers('host') host?: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
    @Headers('sec-fetch-site') secFetchSite?: string,
  ) {
    this.assertSameOriginBrowserRequest(host, origin, referer, secFetchSite);
    return this.diagnostics.runLatestBatch({ limit: body?.limit });
  }

  @ApiOperation({ summary: 'Список запусков диагностики' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiForbiddenResponse({ description: 'Запрос не того origin' })
  @ApiOkResponse({ description: 'Список запусков получен' })
  @Get('runs')
  async runs(
    @Query('limit') limit?: string,
    @Headers('host') host?: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
    @Headers('sec-fetch-site') secFetchSite?: string,
  ) {
    this.assertSameOriginBrowserRequest(host, origin, referer, secFetchSite);
    const parsed = limit ? Number(limit) : undefined;
    return this.diagnostics.listRuns(Number.isFinite(parsed) ? parsed : undefined);
  }

  @ApiOperation({ summary: 'Детали запуска диагностики' })
  @ApiParam({ name: 'id', description: 'ID запуска' })
  @ApiForbiddenResponse({ description: 'Запрос не того origin' })
  @ApiOkResponse({ description: 'Детали запуска получены' })
  @Get('runs/:id')
  async runDetails(
    @Param('id') id: string,
    @Headers('host') host?: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
    @Headers('sec-fetch-site') secFetchSite?: string,
  ) {
    this.assertSameOriginBrowserRequest(host, origin, referer, secFetchSite);
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
  async tradingAdvice(
    @Body() body?: { closedLimit?: number },
    @Headers('host') host?: string,
    @Headers('origin') origin?: string,
    @Headers('referer') referer?: string,
    @Headers('sec-fetch-site') secFetchSite?: string,
  ) {
    this.assertSameOriginBrowserRequest(host, origin, referer, secFetchSite);
    return this.tradingAdvisor.generateAdvice({
      closedLimit: body?.closedLimit,
    });
  }
}
