import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';

import { DEFAULT_APP_TIMEZONE, appCalendarDayRange } from '@repo/shared';

import { isWorkerBybitProcessRole } from '../../config/process-role.util';
import { BybitService } from './bybit.service';

@Injectable()
export class BalanceSnapshotService {
  private readonly logger = new Logger(BalanceSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bybit: BybitService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  /** Раз в сутки (00:05 по APP_TIMEZONE, по умолчанию МСК). */
  @Cron('0 5 0 * * *', { timeZone: DEFAULT_APP_TIMEZONE })
  async cronDailyTotalBalance(): Promise<void> {
    if (!isWorkerBybitProcessRole()) {
      return;
    }
    try {
      const cabinets = await this.cabinets.listCabinets();
      for (const cabinet of cabinets) {
        await this.cabinetContext.runWithCabinet(cabinet.id, async () => {
          const details = await this.bybit.getUnifiedUsdtBalanceDetails();
          if (!details || !Number.isFinite(details.totalUsd)) {
            return;
          }
          await this.upsertToday(details.totalUsd, details.availableUsd);
        });
      }
    } catch (e) {
      this.logger.warn(`cronDailyTotalBalance: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Одна запись на календарный день (APP_TIMEZONE): создаёт или обновляет суммарный баланс за сегодня.
   */
  async upsertToday(totalUsd: number, availableUsd?: number | null): Promise<void> {
    if (!Number.isFinite(totalUsd)) {
      return;
    }
    const available =
      availableUsd != null && Number.isFinite(availableUsd) ? availableUsd : undefined;
    const cabinetId = this.cabinetContext.getCabinetId();
    const { start, end } = appCalendarDayRange();
    const existing = await this.prisma.balanceSnapshot.findFirst({
      where: {
        cabinetId,
        createdAt: { gte: start, lt: end },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const data = {
      totalUsd,
      createdAt: new Date(),
      ...(available !== undefined ? { availableUsd: available } : {}),
    };
    if (existing) {
      await this.prisma.balanceSnapshot.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.balanceSnapshot.create({
        data: { cabinetId, ...data },
      });
    }
  }

  async listRecent(days: number): Promise<{ at: string; totalUsd: number }[]> {
    const d = Math.min(Math.max(1, Math.floor(days)), 365);
    const cabinetId = this.cabinetContext.getCabinetId();
    const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.balanceSnapshot.findMany({
      where: {
        cabinetId,
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, totalUsd: true },
    });
    return rows.map((r) => ({
      at: r.createdAt.toISOString(),
      totalUsd: r.totalUsd,
    }));
  }
}
