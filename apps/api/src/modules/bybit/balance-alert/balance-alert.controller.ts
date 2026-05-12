import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { pickRequestedCabinetId } from '../../../common/cabinet-request.util';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';

import { BalanceAlertService } from './balance-alert.service';

type AuthReq = {
  headers?: Record<string, string | string[] | undefined>;
  auth?: { userId?: string };
};

@ApiTags('Bybit')
@Controller('bybit/balance-alerts')
export class BalanceAlertController {
  constructor(
    private readonly balanceAlert: BalanceAlertService,
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

  @ApiOperation({ summary: 'Список правил уведомлений о балансе (equity) для кабинета' })
  @ApiOkResponse({ description: 'Список получен' })
  @Get()
  async list(@Req() req: AuthReq, @Query('cabinetId') cabinetId?: string) {
    return this.runWithCabinet(req, cabinetId, () => this.balanceAlert.list());
  }

  @ApiOperation({ summary: 'Создать правило (gt = equity выше порога, lt = ниже)' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['operator', 'thresholdUsd'],
      properties: {
        operator: { type: 'string', enum: ['gt', 'lt'] },
        thresholdUsd: { type: 'number', example: 20 },
      },
    },
  })
  @ApiOkResponse({ description: 'Правило создано' })
  @Post()
  async create(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Body() body: { operator?: string; thresholdUsd?: number },
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.balanceAlert.create({
        operator: String(body.operator ?? ''),
        thresholdUsd: Number(body.thresholdUsd),
      }),
    );
  }

  @ApiOperation({ summary: 'Изменить правило' })
  @ApiParam({ name: 'id', description: 'ID правила' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        operator: { type: 'string', enum: ['gt', 'lt'] },
        thresholdUsd: { type: 'number' },
        enabled: { type: 'boolean' },
      },
    },
  })
  @ApiOkResponse({ description: 'Правило обновлено' })
  @Patch(':id')
  async patch(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
    @Body() body: { operator?: string; thresholdUsd?: number; enabled?: boolean },
  ) {
    return this.runWithCabinet(req, cabinetId, () =>
      this.balanceAlert.update(id, {
        operator: body.operator,
        thresholdUsd:
          body.thresholdUsd !== undefined ? Number(body.thresholdUsd) : undefined,
        enabled: body.enabled,
      }),
    );
  }

  @ApiOperation({ summary: 'Удалить правило' })
  @ApiParam({ name: 'id', description: 'ID правила' })
  @ApiOkResponse({ description: 'Правило удалено' })
  @Delete(':id')
  async remove(
    @Req() req: AuthReq,
    @Query('cabinetId') cabinetId: string | undefined,
    @Param('id') id: string,
  ) {
    await this.runWithCabinet(req, cabinetId, () => this.balanceAlert.delete(id));
    return { ok: true };
  }
}
