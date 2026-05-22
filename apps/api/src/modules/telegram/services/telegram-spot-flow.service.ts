import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import type { Context } from 'telegraf';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { BybitSpotPlacementService } from '../../bybit-spot/orders/bybit-spot-placement.service';
import type { SignalOrderOrigin } from '../../bybit/types/bybit.types';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { SettingsService } from '../../settings/settings.service';
import {
  makeExternalRequestKey,
  parseExternalRequestKey,
} from '../utils/telegram-external-request-key.util';
import {
  spotBuyPromptKeyboard,
  spotSellPromptKeyboard,
} from '../utils/telegram-keyboards.util';
import { formatExternalSignalTable } from '../utils/telegram-signal-message-format.util';
import type {
  SpotFlowSession,
  SpotLevelHitNotify,
  SpotSellSession,
} from '../types/telegram-spot-flow.types';
import { TelegramService } from './telegram.service';

const SPOT_SESSION_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class TelegramSpotFlowService {
  private readonly logger = new Logger(TelegramSpotFlowService.name);
  private readonly flowByIngest = new Map<string, SpotFlowSession>();
  private readonly amountInputByUser = new Map<number, string>();
  private readonly sellPercentByUser = new Map<number, SpotSellSession>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLog: AppLogService,
    private readonly cabinetContext: CabinetContextService,
    private readonly cabinets: CabinetService,
    private readonly settings: SettingsService,
    private readonly placement: BybitSpotPlacementService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegram: TelegramService,
  ) {
    this.cleanupTimer = setInterval(() => this.evictExpiredSessions(), 60_000);
  }

  hasActiveSpotDialogForIngest(ingestId: string): boolean {
    const row = this.flowByIngest.get(ingestId);
    if (!row) {
      return false;
    }
    if (Date.now() > row.expiresAt) {
      this.flowByIngest.delete(ingestId);
      return false;
    }
    return true;
  }

  async startSpotPrompt(params: {
    ingestId: string;
    signal: SignalDto;
    rawMessage?: string;
    origin?: SignalOrderOrigin;
  }): Promise<{ ok: boolean; error?: string }> {
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    if (!cabinetId) {
      return { ok: false, error: 'Кабинет не выбран' };
    }
    const expiresAt = Date.now() + SPOT_SESSION_TTL_MS;
    this.flowByIngest.set(params.ingestId, {
      ingestId: params.ingestId,
      cabinetId,
      signal: params.signal,
      rawMessage: params.rawMessage,
      origin: params.origin,
      phase: 'awaiting_spot_decision',
      expiresAt,
    });
    const requestId = makeExternalRequestKey(cabinetId, params.ingestId);
    const symbol = normalizeTradingPair(params.signal.pair);
    const defaultOrderUsd = await this.settings.getDefaultOrderUsd();
    const msg =
      `Пара ${symbol} доступна только на споте.\n\n` +
      `Купить монету на спот?\n\n` +
      formatExternalSignalTable(params.signal, defaultOrderUsd);
    const sent = await this.telegram.broadcastCabinetPlainMessage({
      cabinetId,
      text: msg,
      keyboard: spotBuyPromptKeyboard(requestId),
    });
    if (!sent.ok) {
      this.flowByIngest.delete(params.ingestId);
      return { ok: false, error: sent.error };
    }
    await this.prisma.tgUserbotIngest
      .update({
        where: { id: params.ingestId },
        data: { error: 'Ожидает решение по споту' },
      })
      .catch(() => undefined);
    void this.appLog.append('info', 'telegram', 'Spot buy prompt sent', {
      ingestId: params.ingestId,
      pair: symbol,
      deliveredTo: sent.deliveredTo,
    });
    return { ok: true };
  }

  async notifySpotLevelHit(hit: SpotLevelHitNotify): Promise<void> {
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    if (!cabinetId) {
      return;
    }
    const kindLabel = hit.kind === 'tp' ? `TP${hit.levelIndex + 1}` : 'SL';
    const msg =
      `Спот ${hit.pair}: цена ${hit.lastPrice} достигла ${kindLabel} (${hit.levelPrice}).\n` +
      'Продать часть позиции?';
    await this.telegram.broadcastCabinetPlainMessage({
      cabinetId,
      text: msg,
      keyboard: spotSellPromptKeyboard(hit.signalId, hit.kind, hit.levelIndex),
    });
  }

  async handleSpotBuyYes(ctx: Context, requestId: string): Promise<void> {
    const uid = ctx.from?.id;
    if (!uid) {
      await ctx.answerCbQuery();
      return;
    }
    const parsed = parseExternalRequestKey(requestId);
    const session = this.flowByIngest.get(parsed.ingestId);
    if (!session || session.cabinetId !== parsed.cabinetId) {
      await ctx.answerCbQuery('Сессия истекла');
      await ctx.reply('Сессия спот-покупки истекла. Дождитесь нового сигнала.');
      return;
    }
    session.phase = 'awaiting_spot_amount';
    session.userId = uid;
    session.expiresAt = Date.now() + SPOT_SESSION_TTL_MS;
    this.amountInputByUser.set(uid, parsed.ingestId);
    await ctx.answerCbQuery();
    await this.clearInlineKeyboard(ctx);
    await ctx.reply('Введите сумму покупки в USDT (например 100):');
  }

  async handleSpotBuyNo(ctx: Context, requestId: string): Promise<void> {
    const parsed = parseExternalRequestKey(requestId);
    this.endFlowSession(parsed.ingestId);
    await ctx.answerCbQuery('Отменено');
    await this.clearInlineKeyboard(ctx);
    await this.prisma.tgUserbotIngest
      .update({
        where: { id: parsed.ingestId },
        data: {
          status: 'cancelled_by_confirmation',
          error: 'Спот-покупка отклонена',
        },
      })
      .catch(() => undefined);
    await ctx.reply('Спот-покупка отменена.');
  }

  async tryHandleSpotAmountText(
    userId: number,
    text: string,
  ): Promise<{ handled: false } | { handled: true; message: string }> {
    const ingestId = this.amountInputByUser.get(userId);
    if (!ingestId) {
      return { handled: false };
    }
    const session = this.flowByIngest.get(ingestId);
    if (!session || session.phase !== 'awaiting_spot_amount') {
      this.amountInputByUser.delete(userId);
      return { handled: false };
    }
    const amount = parseFloat(text.replace(',', '.').trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      return { handled: true, message: 'Укажите положительную сумму в USDT (например 100).' };
    }
    this.amountInputByUser.delete(userId);
    let resultMessage = 'Спот-покупка выставлена.';
    await this.cabinetContext.runWithCabinetAsync(session.cabinetId, async () => {
      const place = await this.placement.placeBuy({
        signal: session.signal,
        amountUsdt: amount,
        rawMessage: session.rawMessage,
        origin: session.origin,
      });
      this.endFlowSession(ingestId);
      if (!place.ok) {
        resultMessage = `Не удалось выставить спот-покупку: ${formatError(place.error)}`;
        await this.prisma.tgUserbotIngest
          .update({
            where: { id: ingestId },
            data: { status: 'place_error', error: formatError(place.error) },
          })
          .catch(() => undefined);
        void this.appLog.append('error', 'telegram', 'Spot buy failed', {
          ingestId,
          error: formatError(place.error),
        });
        return;
      }
      await this.prisma.tgUserbotIngest
        .update({
          where: { id: ingestId },
          data: { status: 'placed', error: null },
        })
        .catch(() => undefined);
      resultMessage = `Спот-покупка на ${amount.toFixed(2)} USDT выставлена. signalId=${place.signalId ?? ''}`;
      void this.appLog.append('info', 'telegram', 'Spot buy placed from userbot flow', {
        ingestId,
        signalId: place.signalId,
        amountUsdt: amount,
      });
    });
    return { handled: true, message: resultMessage };
  }

  async tryHandleSpotSellPercentText(
    userId: number,
    text: string,
  ): Promise<{ handled: false } | { handled: true; message: string }> {
    const session = this.sellPercentByUser.get(userId);
    if (!session) {
      return { handled: false };
    }
    if (Date.now() > session.expiresAt) {
      this.sellPercentByUser.delete(userId);
      return { handled: false };
    }
    const percent = parseFloat(text.replace(',', '.').trim());
    if (!Number.isFinite(percent) || percent < 1 || percent > 100) {
      return { handled: true, message: 'Укажите процент от 1 до 100.' };
    }
    this.sellPercentByUser.delete(userId);
    const place = await this.placement.placeSellLimit({
      signalId: session.signalId,
      percent,
      levelKind: session.kind,
      levelIndex: session.levelIndex,
      limitPrice: session.limitPrice,
    });
    if (!place.ok) {
      void this.appLog.append('error', 'telegram', 'Spot sell failed', {
        signalId: session.signalId,
        error: formatError(place.error),
      });
      return {
        handled: true,
        message: `Не удалось выставить продажу: ${formatError(place.error)}`,
      };
    }
    return {
      handled: true,
      message: `Лимитная продажа ${percent}% по ${session.pair} выставлена.`,
    };
  }

  async handleSpotSellYes(
    ctx: Context,
    signalId: string,
    kind: 'tp' | 'sl',
    levelIndex: number,
  ): Promise<void> {
    const uid = ctx.from?.id;
    if (!uid) {
      await ctx.answerCbQuery();
      return;
    }
    const signal = await this.prisma.signal.findFirst({
      where: { id: signalId, deletedAt: null },
      select: { id: true, pair: true, stopLoss: true, takeProfits: true, marketType: true },
    });
    if (!signal || signal.marketType !== 'spot') {
      await ctx.answerCbQuery('Сделка не найдена');
      return;
    }
    let limitPrice = signal.stopLoss;
    if (kind === 'tp') {
      try {
        const tps = JSON.parse(signal.takeProfits) as number[];
        limitPrice = tps[levelIndex] ?? limitPrice;
      } catch {
        // ignore
      }
    }
    const sellSession: SpotSellSession = {
      signalId,
      pair: signal.pair,
      kind,
      levelIndex,
      limitPrice,
      expiresAt: Date.now() + SPOT_SESSION_TTL_MS,
    };
    this.sellPercentByUser.set(uid, sellSession);
    await ctx.answerCbQuery();
    await this.clearInlineKeyboard(ctx);
    await ctx.reply('Введите процент продажи (1–100):');
  }

  async handleSpotSellNo(
    ctx: Context,
    _signalId: string,
    _kind: 'tp' | 'sl',
    _levelIndex: number,
  ): Promise<void> {
    await ctx.answerCbQuery('Ок');
    await this.clearInlineKeyboard(ctx);
    await ctx.reply('Продажа отменена. Позиция остаётся открытой.');
  }

  private endFlowSession(ingestId: string): void {
    const session = this.flowByIngest.get(ingestId);
    if (session?.userId != null) {
      this.amountInputByUser.delete(session.userId);
    }
    this.flowByIngest.delete(ingestId);
  }

  private evictExpiredSessions(): void {
    const now = Date.now();
    for (const [id, s] of this.flowByIngest) {
      if (now > s.expiresAt) {
        this.endFlowSession(id);
      }
    }
    for (const [uid, s] of this.sellPercentByUser) {
      if (now > s.expiresAt) {
        this.sellPercentByUser.delete(uid);
      }
    }
  }

  private async clearInlineKeyboard(ctx: Context): Promise<void> {
    try {
      const anyCtx = ctx as Context & {
        editMessageReplyMarkup?: (markup: { inline_keyboard: [] }) => Promise<unknown>;
      };
      if (typeof anyCtx.editMessageReplyMarkup === 'function') {
        await anyCtx.editMessageReplyMarkup({ inline_keyboard: [] });
      }
    } catch {
      // ignore
    }
  }
}
