import { forwardRef, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { TelegramUserbotMirrorService } from '../telegram-userbot/mirror/telegram-userbot-mirror.service';
import { buildMirrorTradeEventText } from './qpulse-signal-mapper.util';
import { QpulseSyncService } from './qpulse-sync.service';

type MirrorTradeKind = 'tp' | 'sl' | 'close' | 'liquidation' | 'cancel' | 'entry';

@Injectable()
export class SignalDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly qpulseSync: QpulseSyncService,
    @Inject(forwardRef(() => TelegramUserbotMirrorService))
    private readonly mirror: TelegramUserbotMirrorService,
  ) {}

  async onLifecycleUpdate(signalId: string): Promise<void> {
    await this.qpulseSync.patchSignalIfSynced(signalId);
  }

  async onSignalCreated(signalId: string): Promise<void> {
    await this.mirror.tryCreateQpulseForSignal(signalId);
  }

  async onSignalEvent(
    signalId: string,
    type: string,
    payload?: unknown,
  ): Promise<void> {
    const signal = await this.prisma.signal.findFirst({
      where: { id: signalId, deletedAt: null },
      select: {
        id: true,
        pair: true,
        cabinetId: true,
        sourceChatId: true,
        sourceMessageId: true,
        realizedPnl: true,
        liquidation: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        marketType: true,
      },
    });
    if (!signal?.cabinetId) return;

    await this.cabinetContext.runWithCabinetAsync(signal.cabinetId, async () => {
      if (
        type === 'CANCELLED_BY_CHAT' ||
        type === 'SIGNAL_CANCELLED_BY_SOURCE_PRIORITY'
      ) {
        await this.prisma.signal.updateMany({
          where: { id: signalId, cabinetId: signal.cabinetId, deletedAt: null },
          data: { status: 'CANCELLED_BY_CHAT' },
        });
      }

      const p = (payload ?? {}) as Record<string, unknown>;
      let mirrorKind: MirrorTradeKind | null = null;
      let tpNumber: number | undefined;
      let tpPrice: number | null | undefined;
      let entryPrice: number | null | undefined;
      let dedupeSuffix: string | undefined;

      if (type === 'BYBIT_CLOSE_SUCCESS') {
        mirrorKind = 'close';
      } else if (
        type === 'CANCELLED_BY_CHAT' ||
        type === 'SIGNAL_CANCELLED_BY_SOURCE_PRIORITY'
      ) {
        mirrorKind = 'cancel';
        dedupeSuffix = 'cancel';
      } else if (type === 'BYBIT_TP_FILLED') {
        tpNumber = Math.max(1, Math.trunc(Number(p.tpNumber) || 1));
        const price = Number(p.price);
        mirrorKind = 'tp';
        dedupeSuffix = `tp${tpNumber}`;
        tpPrice = Number.isFinite(price) && price > 0 ? price : null;
      } else if (type === 'BYBIT_ENTRY_FILLED') {
        const price = Number(p.price);
        mirrorKind = 'entry';
        dedupeSuffix = 'entry';
        entryPrice = Number.isFinite(price) && price > 0 ? price : null;
      } else if (type === 'TP_SL_STEPPED') {
        await this.qpulseSync.patchSignalIfSynced(signalId);
        return;
      }

      if (mirrorKind) {
        await this.qpulseSync.patchSignalIfSynced(signalId);
      } else {
        await this.qpulseSync.patchSignalIfSynced(signalId);
        return;
      }

      if (!signal.sourceChatId || !signal.sourceMessageId) return;

      const text = buildMirrorTradeEventText({
        kind: mirrorKind,
        pair: signal.pair,
        tpNumber,
        tpPrice,
        entryPrice,
        pnl: signal.realizedPnl,
        leverage: signal.leverage,
        orderUsd: signal.orderUsd,
        capitalPercent: signal.capitalPercent,
        isSpot: String(signal.marketType ?? 'linear').toLowerCase() === 'spot',
      });

      await this.mirror.publishTradeEventToMirrorGroups({
        signalId: signal.id,
        sourceChatId: signal.sourceChatId,
        sourceMessageId: signal.sourceMessageId,
        kind: mirrorKind,
        dedupeSuffix,
        text,
      });
    });
  }

  async onTradeClosed(params: {
    signalId: string;
    liquidation?: boolean;
    realizedPnl?: number | null;
  }): Promise<void> {
    await this.qpulseSync.patchSignalIfSynced(params.signalId);

    const signal = await this.prisma.signal.findFirst({
      where: { id: params.signalId, deletedAt: null },
      select: {
        id: true,
        pair: true,
        cabinetId: true,
        sourceChatId: true,
        sourceMessageId: true,
        realizedPnl: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        marketType: true,
      },
    });
    if (!signal?.cabinetId || !signal.sourceChatId || !signal.sourceMessageId) return;

    const sourceChatId = signal.sourceChatId;
    const sourceMessageId = signal.sourceMessageId;

    await this.cabinetContext.runWithCabinetAsync(signal.cabinetId, async () => {
      const kind = params.liquidation ? 'liquidation' : 'close';
      const text = buildMirrorTradeEventText({
        kind,
        pair: signal.pair,
        pnl: params.realizedPnl ?? signal.realizedPnl,
        leverage: signal.leverage,
        orderUsd: signal.orderUsd,
        capitalPercent: signal.capitalPercent,
        isSpot: String(signal.marketType ?? 'linear').toLowerCase() === 'spot',
      });

      await this.mirror.publishTradeEventToMirrorGroups({
        signalId: signal.id,
        sourceChatId,
        sourceMessageId,
        kind,
        dedupeSuffix: kind,
        text,
      });
    });
  }

  async publishTradeEvent(params: {
    signalId: string;
    sourceChatId?: string | null;
    sourceMessageId?: string | null;
    kind: MirrorTradeKind;
    text: string;
    dedupeSuffix?: string;
  }): Promise<void> {
    if (!params.sourceChatId || !params.sourceMessageId) return;
    await this.mirror.publishTradeEventToMirrorGroups({
      signalId: params.signalId,
      sourceChatId: params.sourceChatId,
      sourceMessageId: params.sourceMessageId,
      kind: params.kind,
      dedupeSuffix: params.dedupeSuffix,
      text: params.text,
    });
    await this.qpulseSync.patchSignalIfSynced(params.signalId);
  }
}
