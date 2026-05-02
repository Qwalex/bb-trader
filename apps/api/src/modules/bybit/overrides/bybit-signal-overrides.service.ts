import { forwardRef, Inject, Injectable } from '@nestjs/common';

import { type SignalDto } from '@repo/shared';

import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { OrdersService } from '../../orders/orders.service';
import { resolveForcedLeverageWithChatOverride } from '../../settings/forced-leverage.util';
import { SettingsService } from '../../settings/settings.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { parseSourceMultiplierMap } from '../instrument/bybit-json.util';

@Injectable()
export class BybitSignalOverridesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cabinetContext: CabinetContextService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
  ) {}

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  /**
   * Глобально: BUMP_TO_MIN_EXCHANGE_LOT (по умолчанию false).
   * По чату userbot: minLotBump — если задан, перекрывает глобальное значение.
   */
  async resolveBumpToMinExchangeLot(chatId?: string): Promise<boolean> {
    const trimmed = chatId?.trim();
    if (trimmed) {
      const cabinetId = this.currentCabinetId();
      if (cabinetId) {
        const scoped = await this.prisma.cabinetTelegramSource.findUnique({
          where: { cabinetId_chatId: { cabinetId, chatId: trimmed } },
          select: { minLotBump: true },
        });
        if (scoped?.minLotBump != null) {
          return scoped.minLotBump;
        }
      }
      const row = await this.prisma.tgUserbotChat.findUnique({
        where: { chatId: trimmed },
        select: { minLotBump: true },
      });
      if (row?.minLotBump != null) {
        return row.minLotBump;
      }
    }
    const raw = await this.settings.get('BUMP_TO_MIN_EXCHANGE_LOT');
    return raw === 'true' || raw === '1';
  }

  async applyForcedLeverage(
    signal: SignalDto,
    origin?: { chatId?: string },
  ): Promise<SignalDto> {
    let chatForced: number | null | undefined;
    const cid = origin?.chatId?.trim();
    if (cid) {
      const cabinetId = this.currentCabinetId();
      if (cabinetId) {
        const scoped = await this.prisma.cabinetTelegramSource.findUnique({
          where: { cabinetId_chatId: { cabinetId, chatId: cid } },
          select: { forcedLeverage: true },
        });
        if (scoped?.forcedLeverage != null) {
          chatForced = scoped.forcedLeverage;
        }
      }
      if (chatForced == null) {
        const row = await this.prisma.tgUserbotChat.findUnique({
          where: { chatId: cid },
          select: { forcedLeverage: true },
        });
        chatForced = row?.forcedLeverage ?? undefined;
      }
    }
    const rawGlobal = await this.settings.get('FORCED_LEVERAGE');
    const src = String(signal.source ?? '').trim();
    const resolved = resolveForcedLeverageWithChatOverride(chatForced, rawGlobal);
    if (resolved == null) {
      return signal;
    }
    if (resolved === signal.leverage) {
      return signal;
    }
    void this.appLog.append('info', 'bybit', 'принудительное плечо', {
      pair: signal.pair,
      source: src || null,
      sourceChatId: cid ?? null,
      leverageBefore: signal.leverage,
      leverageAfter: resolved,
    });
    return { ...signal, leverage: resolved };
  }

  async getCabinetSourceByTitle(source: string): Promise<{
    tpSlStepStart: string | null;
    tpSlStepRange: number | null;
    martingaleMultiplier: number | null;
  } | null> {
    const cabinetId = this.currentCabinetId();
    const title = source.trim();
    if (!cabinetId || !title) {
      return null;
    }
    const chat = await this.prisma.tgUserbotChat.findFirst({
      where: { title: { equals: title, mode: 'insensitive' } },
      select: { chatId: true },
    });
    if (!chat?.chatId) {
      return null;
    }
    return this.prisma.cabinetTelegramSource.findUnique({
      where: {
        cabinetId_chatId: {
          cabinetId,
          chatId: chat.chatId,
        },
      },
      select: {
        tpSlStepStart: true,
        tpSlStepRange: true,
        martingaleMultiplier: true,
      },
    });
  }

  async applySourceMartingaleSizing(signal: SignalDto): Promise<SignalDto> {
    const sourceRaw = String(signal.source ?? '').trim();
    if (!sourceRaw) {
      return signal;
    }

    const [rawMap, rawDefault, scopedSource] = await Promise.all([
      this.settings.get('SOURCE_MARTINGALE_MULTIPLIERS'),
      this.settings.get('SOURCE_MARTINGALE_DEFAULT_MULTIPLIER'),
      this.getCabinetSourceByTitle(sourceRaw),
    ]);
    const bySource = parseSourceMultiplierMap(rawMap);
    const defaultMultiplierParsed = Number(rawDefault);
    const defaultMultiplier =
      Number.isFinite(defaultMultiplierParsed) && defaultMultiplierParsed > 1
        ? defaultMultiplierParsed
        : undefined;
    const multiplier =
      (scopedSource?.martingaleMultiplier != null && scopedSource.martingaleMultiplier > 1
        ? scopedSource.martingaleMultiplier
        : undefined) ??
      bySource.get(sourceRaw.toLowerCase()) ??
      defaultMultiplier;
    if (!multiplier || !Number.isFinite(multiplier) || multiplier <= 1) {
      return signal;
    }

    const prev = await this.orders.getLatestClosedSignalBySource(sourceRaw);
    if (!prev) {
      return signal;
    }
    const isLoss =
      prev.status === 'CLOSED_LOSS' ||
      (typeof prev.realizedPnl === 'number' && prev.realizedPnl < 0);
    if (!isLoss) {
      return signal;
    }

    const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;
    const next = { ...signal };
    if (next.orderUsd > 0) {
      next.orderUsd = round(next.orderUsd * multiplier);
    } else if (next.capitalPercent > 0) {
      next.capitalPercent = Math.min(100_000, round(next.capitalPercent * multiplier));
    }

    void this.appLog.append('info', 'bybit', 'martingale applied by source', {
      source: sourceRaw,
      multiplier,
      prevSignalId: prev.id,
      prevStatus: prev.status,
      prevRealizedPnl: prev.realizedPnl,
      orderUsdBefore: signal.orderUsd,
      orderUsdAfter: next.orderUsd,
      capitalPercentBefore: signal.capitalPercent,
      capitalPercentAfter: next.capitalPercent,
    });

    return next;
  }
}
