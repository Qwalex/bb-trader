import { forwardRef, Inject, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { TelegramUserbotMirrorService } from '../telegram-userbot/mirror/telegram-userbot-mirror.service';
import { buildMirrorTradeEventText } from './qpulse-signal-mapper.util';
import { QpulseSyncService } from './qpulse-sync.service';

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
    void this.qpulseSync.patchSignalIfSynced(signalId);
  }

  async onSignalCreated(signalId: string): Promise<void> {
    void this.mirror.tryCreateQpulseForSignal(signalId);
  }

  async onSignalEvent(
    signalId: string,
    type: string,
    payload?: unknown,
  ): Promise<void> {
    const cabinetId = this.cabinetContext.getCabinetId();
    if (
      cabinetId &&
      (type === 'CANCELLED_BY_CHAT' || type === 'SIGNAL_CANCELLED_BY_SOURCE_PRIORITY')
    ) {
      await this.prisma.signal.updateMany({
        where: { id: signalId, cabinetId, deletedAt: null },
        data: { status: 'CANCELLED_BY_CHAT' },
      });
    }

    void this.qpulseSync.patchSignalIfSynced(signalId);

    const signal = await this.prisma.signal.findFirst({
      where: { id: signalId, cabinetId, deletedAt: null },
      select: {
        id: true,
        pair: true,
        sourceChatId: true,
        sourceMessageId: true,
        realizedPnl: true,
        liquidation: true,
      },
    });
    if (!signal?.sourceChatId || !signal.sourceMessageId) return;

    const p = (payload ?? {}) as Record<string, unknown>;
    let kind: 'tp' | 'sl' | 'close' | 'liquidation' | 'cancel' | null = null;
    let detail: string | undefined;

    if (type === 'BYBIT_CLOSE_SUCCESS') {
      kind = 'close';
    } else if (type === 'CANCELLED_BY_CHAT' || type === 'SIGNAL_CANCELLED_BY_SOURCE_PRIORITY') {
      kind = 'cancel';
    } else if (type === 'TP_SL_STEPPED') {
      kind = 'tp';
      detail =
        p.step != null
          ? `TP step ${String(p.step)}`
          : 'Take profit / SL step';
    }

    if (!kind) return;

    const text = buildMirrorTradeEventText({
      kind,
      pair: signal.pair,
      detail,
      pnl: signal.realizedPnl,
    });

    void this.mirror.publishTradeEventToMirrorGroups({
      signalId: signal.id,
      sourceChatId: signal.sourceChatId,
      sourceMessageId: signal.sourceMessageId,
      kind,
      text,
    });
  }

  async onTradeClosed(params: {
    signalId: string;
    liquidation?: boolean;
    realizedPnl?: number | null;
  }): Promise<void> {
    void this.qpulseSync.patchSignalIfSynced(params.signalId);

    const cabinetId = this.cabinetContext.getCabinetId();
    const signal = await this.prisma.signal.findFirst({
      where: { id: params.signalId, cabinetId, deletedAt: null },
      select: {
        id: true,
        pair: true,
        sourceChatId: true,
        sourceMessageId: true,
        realizedPnl: true,
      },
    });
    if (!signal?.sourceChatId || !signal.sourceMessageId) return;

    const kind = params.liquidation ? 'liquidation' : 'close';
    const text = buildMirrorTradeEventText({
      kind,
      pair: signal.pair,
      pnl: params.realizedPnl ?? signal.realizedPnl,
    });

    void this.mirror.publishTradeEventToMirrorGroups({
      signalId: signal.id,
      sourceChatId: signal.sourceChatId,
      sourceMessageId: signal.sourceMessageId,
      kind,
      text,
    });
  }

  async publishTradeEvent(params: {
    signalId: string;
    sourceChatId?: string | null;
    sourceMessageId?: string | null;
    kind: 'tp' | 'sl' | 'close' | 'liquidation' | 'cancel';
    text: string;
  }): Promise<void> {
    if (!params.sourceChatId || !params.sourceMessageId) return;
    await this.mirror.publishTradeEventToMirrorGroups({
      signalId: params.signalId,
      sourceChatId: params.sourceChatId,
      sourceMessageId: params.sourceMessageId,
      kind: params.kind,
      text: params.text,
    });
    void this.qpulseSync.patchSignalIfSynced(params.signalId);
  }
}
