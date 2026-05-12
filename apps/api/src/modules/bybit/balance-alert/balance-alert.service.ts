import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { postCriticalNotifyText } from '../../../common/critical-notify.util';
import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { BybitService } from '../bybit.service';

import type { BalanceAlertOperator, BalanceAlertRuleDto } from './balance-alert.types';
import { BALANCE_ALERT_OPERATORS } from './balance-alert.types';

type RuleRow = {
  id: string;
  cabinetId: string;
  operator: string;
  thresholdUsd: number;
  enabled: boolean;
  lastSatisfied: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class BalanceAlertService {
  private readonly logger = new Logger(BalanceAlertService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly cabinets: CabinetService,
    private readonly bybit: BybitService,
  ) {}

  private currentCabinetId(): string {
    const id = this.cabinetContext.getCabinetId();
    if (!id) {
      throw new ForbiddenException('cabinet context required');
    }
    return id;
  }

  private toDto(row: RuleRow): BalanceAlertRuleDto {
    return {
      id: row.id,
      cabinetId: row.cabinetId,
      operator: row.operator as BalanceAlertOperator,
      thresholdUsd: row.thresholdUsd,
      enabled: row.enabled,
      lastSatisfied: row.lastSatisfied,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private parseOperator(v: unknown): BalanceAlertOperator | null {
    const s = String(v ?? '').trim();
    return (BALANCE_ALERT_OPERATORS as readonly string[]).includes(s)
      ? (s as BalanceAlertOperator)
      : null;
  }

  async list(): Promise<{ items: BalanceAlertRuleDto[] }> {
    const cabinetId = this.currentCabinetId();
    const items = await this.prisma.cabinetBalanceAlertRule.findMany({
      where: { cabinetId },
      orderBy: { createdAt: 'desc' },
    });
    return { items: items.map((r) => this.toDto(r)) };
  }

  async create(params: {
    operator: string;
    thresholdUsd: number;
  }): Promise<{ rule: BalanceAlertRuleDto }> {
    const cabinetId = this.currentCabinetId();
    const op = this.parseOperator(params.operator);
    if (!op) {
      throw new BadRequestException('operator must be "gt" or "lt"');
    }
    if (!Number.isFinite(params.thresholdUsd) || params.thresholdUsd <= 0) {
      throw new BadRequestException('thresholdUsd must be a positive number');
    }
    const row = await this.prisma.cabinetBalanceAlertRule.create({
      data: {
        cabinetId,
        operator: op,
        thresholdUsd: params.thresholdUsd,
        enabled: true,
        lastSatisfied: null,
      },
    });
    return { rule: this.toDto(row) };
  }

  async update(
    id: string,
    patch: { operator?: string; thresholdUsd?: number; enabled?: boolean },
  ): Promise<{ rule: BalanceAlertRuleDto }> {
    const cabinetId = this.currentCabinetId();
    const existing = await this.prisma.cabinetBalanceAlertRule.findFirst({
      where: { id, cabinetId },
    });
    if (!existing) {
      throw new NotFoundException('rule not found');
    }
    const data: {
      operator?: string;
      thresholdUsd?: number;
      enabled?: boolean;
      lastSatisfied?: boolean | null;
    } = {};
    if (patch.operator !== undefined) {
      const op = this.parseOperator(patch.operator);
      if (!op) {
        throw new BadRequestException('operator must be "gt" or "lt"');
      }
      data.operator = op;
    }
    if (patch.thresholdUsd !== undefined) {
      if (!Number.isFinite(patch.thresholdUsd) || patch.thresholdUsd <= 0) {
        throw new BadRequestException('thresholdUsd must be a positive number');
      }
      data.thresholdUsd = patch.thresholdUsd;
    }
    if (patch.enabled !== undefined) {
      data.enabled = Boolean(patch.enabled);
    }
    if (data.operator !== undefined || data.thresholdUsd !== undefined) {
      data.lastSatisfied = null;
    }
    if (Object.keys(data).length === 0) {
      return { rule: this.toDto(existing) };
    }
    const row = await this.prisma.cabinetBalanceAlertRule.update({
      where: { id },
      data,
    });
    return { rule: this.toDto(row) };
  }

  async delete(id: string): Promise<void> {
    const cabinetId = this.currentCabinetId();
    const res = await this.prisma.cabinetBalanceAlertRule.deleteMany({
      where: { id, cabinetId },
    });
    if (res.count === 0) {
      throw new NotFoundException('rule not found');
    }
  }

  /** Cron: все кабинеты с включёнными правилами. */
  async tickAllCabinets(): Promise<void> {
    const cabinets = await this.cabinets.listCabinets();
    for (const cab of cabinets) {
      const count = await this.prisma.cabinetBalanceAlertRule.count({
        where: { cabinetId: cab.id, enabled: true },
      });
      if (count === 0) {
        continue;
      }
      await this.cabinetContext.runWithCabinet(cab.id, async () => {
        try {
          await this.evaluateCabinetTick(cab.id);
        } catch (e) {
          this.logger.warn(`balance alert tick cabinet=${cab.id}: ${formatError(e)}`);
        }
      });
    }
  }

  private async evaluateCabinetTick(cabinetId: string): Promise<void> {
    const rules = await this.prisma.cabinetBalanceAlertRule.findMany({
      where: { cabinetId, enabled: true },
    });
    if (!rules.length) {
      return;
    }
    const details = await this.bybit.getUnifiedUsdtBalanceDetails();
    if (!details || !Number.isFinite(details.totalUsd)) {
      this.logger.warn(`balance alert: no USDT balance for cabinet=${cabinetId}`);
      return;
    }
    const totalUsd = details.totalUsd;
    const label = await this.cabinets.getCabinetDisplayLabel(cabinetId);
    for (const rule of rules) {
      await this.applyRuleEvaluation(rule, totalUsd, label);
    }
  }

  private async applyRuleEvaluation(
    rule: { id: string; operator: string; thresholdUsd: number; lastSatisfied: boolean | null },
    totalUsd: number,
    cabinetLabel: string,
  ): Promise<void> {
    if (rule.operator !== 'gt' && rule.operator !== 'lt') {
      return;
    }
    const ok =
      rule.operator === 'gt'
        ? totalUsd > rule.thresholdUsd
        : totalUsd < rule.thresholdUsd;

    if (rule.lastSatisfied === null) {
      await this.prisma.cabinetBalanceAlertRule.update({
        where: { id: rule.id },
        data: { lastSatisfied: ok },
      });
      return;
    }
    if (ok && !rule.lastSatisfied) {
      const opLabel = rule.operator === 'gt' ? '>' : '<';
      const text = [
        'Баланс (equity USDT): сработало пороговое правило.',
        `Кабинет: ${cabinetLabel}`,
        `Правило: id=${rule.id}, условие equity ${opLabel} ${rule.thresholdUsd}, сейчас totalUsd=${totalUsd.toFixed(4)}`,
      ].join(' ');
      await postCriticalNotifyText(text, (m) => this.logger.warn(m));
    }
    await this.prisma.cabinetBalanceAlertRule.update({
      where: { id: rule.id },
      data: { lastSatisfied: ok },
    });
  }
}
