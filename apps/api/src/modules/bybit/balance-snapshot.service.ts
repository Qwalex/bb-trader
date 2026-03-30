import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';

import { BybitService } from './bybit.service';

/** Границы текущих суток в UTC (одна запись на календарный день). */
function utcTodayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

@Injectable()
export class BalanceSnapshotService {
  private readonly logger = new Logger(BalanceSnapshotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bybit: BybitService,
  ) {}

  /** Раз в сутки (00:05 UTC): читаем суммарный баланс с Bybit и сохраняем в БД. */
  @Cron('0 5 0 * * *')
  async cronDailyTotalBalance(): Promise<void> {
    try {
      const details = await this.bybit.getUnifiedUsdtBalanceDetails();
      if (!details || !Number.isFinite(details.totalUsd)) {
        return;
      }
      await this.upsertToday(details.totalUsd);
    } catch (e) {
      this.logger.warn(`cronDailyTotalBalance: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Одна запись на календарный день (UTC): создаёт или обновляет суммарный баланс за сегодня.
   * Вызывается из cron и при открытии дашборда (userbot status), если нужно зафиксировать день.
   */
  async upsertToday(totalUsd: number): Promise<void> {
    if (!Number.isFinite(totalUsd)) {
      return;
    }
    const { start, end } = utcTodayRange();
    const existing = await this.prisma.balanceSnapshot.findFirst({
      where: { createdAt: { gte: start, lt: end } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.balanceSnapshot.update({
        where: { id: existing.id },
        data: { totalUsd, createdAt: new Date() },
      });
    } else {
      await this.prisma.balanceSnapshot.create({
        data: { totalUsd },
      });
    }
  }

  async listRecent(days: number): Promise<{ at: string; totalUsd: number }[]> {
    const d = Math.min(Math.max(1, Math.floor(days)), 365);
    const since = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.balanceSnapshot.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, totalUsd: true },
    });
    return rows.map((r) => ({
      at: r.createdAt.toISOString(),
      totalUsd: r.totalUsd,
    }));
  }
}
