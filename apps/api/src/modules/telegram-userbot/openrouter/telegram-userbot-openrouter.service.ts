import { Injectable, Logger } from '@nestjs/common';

import { startOfAppCalendarDay } from '@repo/shared';

import { postCriticalNotifyText } from '../../../common/critical-notify.util';
import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { TranscriptService } from '../../transcript/transcript.service';
import {
  OPENROUTER_BALANCE_LOW_THRESHOLD_USD,
  OPENROUTER_BALANCE_NOTIFY_COOLDOWN_MS,
} from '../telegram-userbot.constants';
import type { OpenrouterSpendPeriod } from '../telegram-userbot.types';
import {
  bucketKeyByPeriod,
  resolveOpenrouterPeriodStart,
} from './telegram-userbot-openrouter.util';

@Injectable()
export class TelegramUserbotOpenrouterService {
  private readonly logger = new Logger(TelegramUserbotOpenrouterService.name);
  /** Дедуп уведомлений о низком балансе OpenRouter (не путать с critical API в фасаде userbot). */
  private readonly lastLowBalanceNotifyAtByKey = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly transcript: TranscriptService,
  ) {}

  async getTodayOpenRouterSpendByChatId(): Promise<Record<string, number>> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const dayStart = startOfAppCalendarDay();
    const rows = await this.prisma.openrouterGenerationCost.findMany({
      where: {
        cabinetId,
        status: 'resolved',
        costUsd: { not: null },
        createdAt: { gte: dayStart },
      },
      select: { chatId: true, costUsd: true },
    });
    const sums: Record<string, number> = {};
    for (const row of rows) {
      const chatId = String(row.chatId ?? '').trim();
      if (!chatId) continue;
      const costUsd = Number(row.costUsd ?? NaN);
      if (!Number.isFinite(costUsd) || costUsd < 0) continue;
      sums[chatId] = (sums[chatId] ?? 0) + costUsd;
    }
    return sums;
  }

  async getOpenrouterSpendAnalytics(period: OpenrouterSpendPeriod = 'day') {
    const cabinetId = this.cabinetContext.getCabinetId();
    const safePeriod: OpenrouterSpendPeriod =
      period === 'day' ||
      period === '3d' ||
      period === 'week' ||
      period === 'month' ||
      period === 'year'
        ? period
        : 'day';
    const startAt = resolveOpenrouterPeriodStart(safePeriod);
    const endAt = new Date();
    const [rows, chats] = await Promise.all([
      this.prisma.openrouterGenerationCost.findMany({
        where: {
          cabinetId,
          status: 'resolved',
          costUsd: { not: null },
          createdAt: { gte: startAt, lte: endAt },
        },
        select: { createdAt: true, chatId: true, costUsd: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.tgUserbotChat.findMany({
        select: { chatId: true, title: true },
      }),
    ]);
    const titleByChatId = new Map<string, string>();
    for (const c of chats) {
      const chatId = String(c.chatId ?? '').trim();
      if (!chatId) continue;
      const title = String(c.title ?? '').trim();
      titleByChatId.set(chatId, title || chatId);
    }

    const sourceTotals = new Map<
      string,
      { chatId: string; source: string; totalUsd: number; requests: number }
    >();
    const bucketTotals = new Map<string, { at: string; totalUsd: number }>();
    let totalUsd = 0;
    let requests = 0;

    for (const row of rows) {
      const chatId = String(row.chatId ?? '').trim();
      const costUsd = Number(row.costUsd ?? NaN);
      if (!chatId || !Number.isFinite(costUsd) || costUsd < 0) continue;
      const sourceName = titleByChatId.get(chatId) ?? chatId;
      const currentSource = sourceTotals.get(chatId) ?? {
        chatId,
        source: sourceName,
        totalUsd: 0,
        requests: 0,
      };
      currentSource.totalUsd += costUsd;
      currentSource.requests += 1;
      sourceTotals.set(chatId, currentSource);

      const createdAtRaw = row.createdAt;
      const createdAt =
        createdAtRaw instanceof Date ? createdAtRaw : new Date(String(createdAtRaw ?? ''));
      if (!Number.isFinite(createdAt.getTime())) continue;
      const bucketKey = bucketKeyByPeriod(createdAt, safePeriod);
      const currentBucket = bucketTotals.get(bucketKey) ?? { at: bucketKey, totalUsd: 0 };
      currentBucket.totalUsd += costUsd;
      bucketTotals.set(bucketKey, currentBucket);

      totalUsd += costUsd;
      requests += 1;
    }

    return {
      period: safePeriod,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      totalUsd: Number(totalUsd.toFixed(8)),
      requests,
      bySource: Array.from(sourceTotals.values())
        .map((s) => ({
          ...s,
          avgUsd: s.requests > 0 ? Number((s.totalUsd / s.requests).toFixed(8)) : 0,
          totalUsd: Number(s.totalUsd.toFixed(8)),
        }))
        .sort((a, b) => b.totalUsd - a.totalUsd),
      timeline: Array.from(bucketTotals.values())
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
        .map((p) => ({ ...p, totalUsd: Number(p.totalUsd.toFixed(8)) })),
    };
  }

  async getOpenrouterBalance() {
    const snapshot = await this.transcript.getOpenrouterBalance();
    const thresholdUsd = OPENROUTER_BALANCE_LOW_THRESHOLD_USD;
    const balanceUsd = snapshot.balanceUsd;
    const lowBalance =
      balanceUsd != null &&
      Number.isFinite(balanceUsd) &&
      balanceUsd < thresholdUsd;
    if (lowBalance && balanceUsd != null) {
      await this.notifyOpenrouterLowBalance(balanceUsd, thresholdUsd);
    }
    return {
      ...snapshot,
      lowBalance,
      thresholdUsd,
    };
  }

  private async notifyOpenrouterLowBalance(
    balanceUsd: number,
    thresholdUsd: number,
  ): Promise<void> {
    const dedupKey = `openrouter-low-balance:${thresholdUsd}`;
    const now = Date.now();
    const prev = this.lastLowBalanceNotifyAtByKey.get(dedupKey) ?? 0;
    if (now - prev < OPENROUTER_BALANCE_NOTIFY_COOLDOWN_MS) {
      return;
    }
    this.lastLowBalanceNotifyAtByKey.set(dedupKey, now);
    const text =
      `[CRITICAL OPENROUTER LOW BALANCE]\n` +
      `balanceUsd=${balanceUsd.toFixed(4)}\n` +
      `thresholdUsd=${thresholdUsd.toFixed(2)}`;
    await postCriticalNotifyText(text, (m) => this.logger.warn(m));
  }
}
