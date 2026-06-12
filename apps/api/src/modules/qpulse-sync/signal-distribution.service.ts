import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';

import { shouldRunUserbotMtproto } from '../../config/process-role.util';
import { PrismaService } from '../../prisma/prisma.service';
import { parseNumberArrayFromJson } from '../bybit/instrument/bybit-json.util';
import { isFilledOrderStatus } from '../bybit/orders/bybit-order-status.util';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import {
  normalizeDirection,
  resolveEntryMid,
} from '../telegram-userbot/mirror/telegram-userbot-mirror-format.util';
import { TelegramUserbotMirrorService } from '../telegram-userbot/mirror/telegram-userbot-mirror.service';
import { buildMirrorCloseEventText, buildMirrorTradeEventText, resolveMirrorCloseContext } from './qpulse-signal-mapper.util';
import { QpulseSyncService } from './qpulse-sync.service';

type MirrorTradeKind = 'tp' | 'sl' | 'close' | 'liquidation' | 'cancel' | 'entry';

@Injectable()
export class SignalDistributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly qpulseSync: QpulseSyncService,
    @Optional()
    @Inject(forwardRef(() => TelegramUserbotMirrorService))
    private readonly mirror: TelegramUserbotMirrorService | null,
  ) {}

  private canMirror(): boolean {
    return shouldRunUserbotMtproto() && this.mirror != null;
  }

  async onLifecycleUpdate(signalId: string): Promise<void> {
    await this.qpulseSync.patchSignalIfSynced(signalId);
  }

  async onSignalCreated(signalId: string): Promise<void> {
    if (!this.canMirror()) return;
    await this.mirror!.tryCreateQpulseForSignal(signalId);
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
        direction: true,
        entries: true,
        takeProfits: true,
        realizedPnl: true,
        liquidation: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        marketType: true,
        stopLoss: true,
        status: true,
        orders: {
          select: {
            orderKind: true,
            status: true,
            price: true,
            qty: true,
          },
        },
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

      if (!this.canMirror()) {
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

      const tradeDirection = normalizeDirection(
        signal.direction === 'short' ? 'short' : 'long',
      );
      let tpEntryPrice = resolveEntryMid(parseNumberArrayFromJson(signal.entries));
      if (tpEntryPrice <= 0) {
        const filledEntry = signal.orders.find(
          (o) =>
            (o.orderKind === 'ENTRY' || o.orderKind === 'DCA') &&
            isFilledOrderStatus(o.status) &&
            o.price != null &&
            Number(o.price) > 0,
        );
        tpEntryPrice = filledEntry?.price != null ? Number(filledEntry.price) : 0;
      }

      const text = buildMirrorTradeEventText({
        kind: mirrorKind,
        pair: signal.pair,
        tpNumber,
        tpPrice,
        tpDirection: mirrorKind === 'tp' ? tradeDirection : undefined,
        tpEntryPrice: mirrorKind === 'tp' && tpEntryPrice > 0 ? tpEntryPrice : null,
        tpTakeProfits:
          mirrorKind === 'tp' ? parseNumberArrayFromJson(signal.takeProfits) : undefined,
        entryPrice,
        pnl: signal.realizedPnl,
        leverage: signal.leverage,
        orderUsd: signal.orderUsd,
        capitalPercent: signal.capitalPercent,
        isSpot: String(signal.marketType ?? 'linear').toLowerCase() === 'spot',
        closeStatus: signal.status,
        closeDirection: signal.direction,
        closeTakeProfits: signal.takeProfits,
        closeEntries: signal.entries,
        closeStopLoss: signal.stopLoss,
        closeOrders: signal.orders,
      });

      await this.mirror!.publishTradeEventToMirrorGroups({
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
        status: true,
        direction: true,
        entries: true,
        stopLoss: true,
        takeProfits: true,
        realizedPnl: true,
        liquidation: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        marketType: true,
        orders: {
          select: {
            orderKind: true,
            status: true,
            price: true,
            qty: true,
          },
        },
      },
    });
    if (!signal?.cabinetId || !signal.sourceChatId || !signal.sourceMessageId) return;
    if (!this.canMirror()) return;

    const sourceChatId = signal.sourceChatId;
    const sourceMessageId = signal.sourceMessageId;

    await this.cabinetContext.runWithCabinetAsync(signal.cabinetId, async () => {
      const closeInput = {
        pair: signal.pair,
        status: signal.status,
        direction: signal.direction,
        takeProfits: signal.takeProfits,
        entries: signal.entries,
        stopLoss: signal.stopLoss,
        liquidation: params.liquidation ?? signal.liquidation === true,
        realizedPnl: params.realizedPnl ?? signal.realizedPnl,
        leverage: signal.leverage,
        orderUsd: signal.orderUsd,
        capitalPercent: signal.capitalPercent,
        marketType: signal.marketType,
        orders: signal.orders,
      };
      const { mirrorKind } = resolveMirrorCloseContext(closeInput);
      const text = buildMirrorCloseEventText(closeInput);

      await this.mirror!.publishTradeEventToMirrorGroups({
        signalId: signal.id,
        sourceChatId,
        sourceMessageId,
        kind: mirrorKind,
        dedupeSuffix: mirrorKind,
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
    if (!this.canMirror()) {
      await this.qpulseSync.patchSignalIfSynced(params.signalId);
      return;
    }
    await this.mirror!.publishTradeEventToMirrorGroups({
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
