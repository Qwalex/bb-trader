import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { BybitService } from '../../bybit/bybit.service';
import { OrdersService } from '../../orders/orders.service';
import { SettingsService } from '../../settings/settings.service';
import { TranscriptService } from '../../transcript/transcript.service';
import { TelegramService } from '../../telegram';
import { VkNotifyMirrorService } from '../../vk/vk-notify-mirror.service';
import { parseSignalPriceArrayJson } from '../userbot-signal-hash.util';
import { TelegramUserbotSettingsService } from '../settings/telegram-userbot-settings.service';
import { TelegramUserbotIngestPairDirectionService } from './telegram-userbot-ingest-pair-direction.service';
import { TelegramUserbotIngestSignalLookupService } from './telegram-userbot-ingest-signal-lookup.service';
import { arePriceArraysClose, isNumberClose } from '../utils/telegram-userbot-text-similarity.util';

@Injectable()
export class TelegramUserbotIngestSignalReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transcript: TranscriptService,
    private readonly bybit: BybitService,
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly settings: SettingsService,
    private readonly telegramBot: TelegramService,
    @Inject(forwardRef(() => VkNotifyMirrorService))
    private readonly vkNotifyMirror: VkNotifyMirrorService,
    private readonly userbotSettings: TelegramUserbotSettingsService,
    private readonly signalLookup: TelegramUserbotIngestSignalLookupService,
    private readonly pairDirection: TelegramUserbotIngestPairDirectionService,
  ) {}

  private async getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.settings.get(key);
    if (raw == null || raw.trim() === '') {
      return fallback;
    }
    return raw.trim().toLowerCase() === 'true';
  }

  async tryReentryFromReply(params: {
    chatId: string;
    messageId: string;
    text: string;
    replyToMessageId?: string;
    signalExternalId?: string;
  }): Promise<{ ok: true; mode: 'updated' | 'replaced' } | { ok: false; error: string }> {
    const replyToMessageId = params.replyToMessageId?.trim() || undefined;
    const signalExternalId = params.signalExternalId?.trim() || undefined;
    if (!replyToMessageId && !signalExternalId) {
      return {
        ok: false,
        error: 'Сообщение о перезаходе без цитаты исходного сигнала и без SIGNAL ID',
      };
    }
    const lookup = await this.signalLookup.findActiveSignalFromReply({
      chatId: params.chatId,
      replyToMessageId,
      signalExternalId,
      flowLabel: 'Reentry',
    });
    if (!lookup.ok) {
      return { ok: false, error: lookup.error };
    }
    const rootSource = lookup.rootSource;
    const prev = lookup.signal;
    const base = this.signalFromDb(prev);
    const closeCooldownMs = this.pairDirection.getCloseCooldownRemainingMs(base.pair, base.direction);
    if (closeCooldownMs > 0) {
      return {
        ok: false,
        error: `Перезаход временно заблокирован после close (${Math.ceil(closeCooldownMs / 1000)}s)`,
      };
    }
    await this.bybit.suspendStaleReconcile(
      base.pair,
      base.direction,
      'reentry flow',
      prev.cabinetId ?? null,
    );
    try {
      void this.appLog.append('debug', 'telegram', 'Reentry: resolved root source message', {
        sourceChatId: params.chatId,
        quotedMessageId: replyToMessageId,
        rootSourceMessageId: rootSource.messageId,
        quoteChain: rootSource.chain,
        matchedSignalMessageIds: rootSource.matchedSignalMessageIds,
        stopReason: rootSource.stopReason,
      });

      const [originalMessageText, quotedMessageText] = await Promise.all([
        this.signalLookup.fetchChatMessageText(params.chatId, rootSource.messageId),
        replyToMessageId && replyToMessageId !== rootSource.messageId
          ? this.signalLookup.fetchChatMessageText(params.chatId, replyToMessageId)
          : Promise.resolve(undefined),
      ]);
      const reentryOverrides = await this.userbotSettings.buildTranscriptParseOverrides(params.chatId);
      const parsed = await this.transcript.parse(
        'text',
        {
          text: params.text,
          reentryContext: {
            baseSignal: base,
            rootSourceMessageId: rootSource.messageId,
            originalMessageText,
            quotedMessageText,
          },
        },
        reentryOverrides,
      );
      if (parsed.ok === false) {
        return { ok: false, error: parsed.error };
      }

      const updatePartial = parsed.ok === true ? parsed.signal : parsed.partial;
      if (
        (updatePartial.pair &&
          normalizeTradingPair(updatePartial.pair) !== normalizeTradingPair(base.pair)) ||
        (updatePartial.direction && updatePartial.direction !== base.direction)
      ) {
        return {
          ok: false,
          error: 'Перезаход не совпадает с исходным сигналом по паре/направлению',
        };
      }

      const hasEntriesProvided =
        Array.isArray(updatePartial.entries) && updatePartial.entries.length > 0;
      const hasLeverageProvided =
        typeof updatePartial.leverage === 'number' && updatePartial.leverage >= 1;
      const hasOrderUsdProvided =
        typeof updatePartial.orderUsd === 'number' && updatePartial.orderUsd >= 0;
      const hasCapitalPercentProvided =
        typeof updatePartial.capitalPercent === 'number' && updatePartial.capitalPercent >= 0;
      const hasOtherFieldProvided =
        Boolean(updatePartial.pair) ||
        Boolean(updatePartial.direction) ||
        hasEntriesProvided ||
        hasLeverageProvided ||
        hasOrderUsdProvided ||
        hasCapitalPercentProvided;

      const hasStopLossProvided = typeof updatePartial.stopLoss === 'number';
      const hasTakeProfitsProvided =
        Array.isArray(updatePartial.takeProfits) && updatePartial.takeProfits.length > 0;
      const nextStopLoss = hasStopLossProvided ? updatePartial.stopLoss : undefined;
      const nextTakeProfits = hasTakeProfitsProvided ? updatePartial.takeProfits : undefined;
      const hasStopLossChanged =
        nextStopLoss !== undefined && !isNumberClose(nextStopLoss, base.stopLoss);
      const hasTakeProfitsChanged =
        Array.isArray(nextTakeProfits) && !arePriceArraysClose(nextTakeProfits, base.takeProfits);

      if (!hasOtherFieldProvided && (hasStopLossChanged || hasTakeProfitsChanged)) {
        await this.prisma.signal.update({
          where: { id: prev.id },
          data: {
            stopLoss: hasStopLossChanged ? nextStopLoss : undefined,
            takeProfits: hasTakeProfitsChanged
              ? JSON.stringify(nextTakeProfits)
              : undefined,
          },
        });
        await this.orders.createSignalEvent(prev.id, 'REENTRY_UPDATED', {
          sourceChatId: params.chatId,
          sourceMessageId: rootSource.messageId,
          reentryMessageId: params.messageId,
          changedFields: {
            stopLoss: hasStopLossChanged
              ? { from: base.stopLoss, to: nextStopLoss }
              : null,
            takeProfits: hasTakeProfitsChanged
              ? { from: base.takeProfits, to: nextTakeProfits }
              : null,
          },
        });
        void this.appLog.append('info', 'telegram', 'Перезаход: обновлены SL/TP в существующем сигнале', {
          signalId: prev.id,
          sourceChatId: params.chatId,
          sourceMessageId: rootSource.messageId,
          quotedMessageId: params.replyToMessageId,
          reentryMessageId: params.messageId,
          changed: {
            stopLoss: hasStopLossChanged,
            takeProfits: hasTakeProfitsChanged,
          },
        });
        return { ok: true, mode: 'updated' };
      }

      const nextSignal: SignalDto = {
        pair: updatePartial.pair ?? base.pair,
        direction: updatePartial.direction ?? base.direction,
        entries:
          Array.isArray(updatePartial.entries) && updatePartial.entries.length > 0
            ? updatePartial.entries
            : base.entries,
        entryIsRange:
          typeof updatePartial.entryIsRange === 'boolean'
            ? updatePartial.entryIsRange
            : (base.entryIsRange ?? false),
        stopLoss:
          typeof updatePartial.stopLoss === 'number' ? updatePartial.stopLoss : base.stopLoss,
        takeProfits:
          Array.isArray(updatePartial.takeProfits) && updatePartial.takeProfits.length > 0
            ? updatePartial.takeProfits
            : base.takeProfits,
        leverage:
          typeof updatePartial.leverage === 'number' && updatePartial.leverage >= 1
            ? Math.floor(updatePartial.leverage)
            : base.leverage,
        orderUsd:
          typeof updatePartial.orderUsd === 'number' && updatePartial.orderUsd >= 0
            ? updatePartial.orderUsd
            : base.orderUsd,
        capitalPercent:
          typeof updatePartial.capitalPercent === 'number' && updatePartial.capitalPercent >= 0
            ? updatePartial.capitalPercent
            : base.capitalPercent,
        source: base.source,
      };

      const closed = await this.bybit.closeSignalManually(prev.id);
      if (!closed.ok) {
        return {
          ok: false,
          error: closed.error ?? closed.details ?? 'Не удалось закрыть предыдущую позицию',
        };
      }

      const place = await this.bybit.placeSignalOrders(nextSignal, params.text, {
        chatId: params.chatId,
        messageId: rootSource.messageId,
        signalExternalId: params.signalExternalId?.trim() || undefined,
      });
      if (!place.ok) {
        return { ok: false, error: formatError(place.error) };
      }

      await this.prisma.signal.update({
        where: { id: prev.id },
        data: { deletedAt: new Date() },
      });
      await this.orders.createSignalEvent(prev.id, 'REENTRY_REPLACED_OLD', {
        reason: 'Перезаход: старый сигнал заменен новым',
        sourceChatId: params.chatId,
        sourceMessageId: rootSource.messageId,
        reentryMessageId: params.messageId,
        newSignalId: place.signalId,
      });
      if (place.signalId) {
        await this.orders.createSignalEvent(place.signalId, 'REENTRY_REPLACED_NEW', {
          reason: 'Перезаход: создан новый сигнал',
          sourceChatId: params.chatId,
          sourceMessageId: rootSource.messageId,
          reentryMessageId: params.messageId,
          oldSignalId: prev.id,
          mergedFields: {
            entries: nextSignal.entries,
            stopLoss: nextSignal.stopLoss,
            takeProfits: nextSignal.takeProfits,
            leverage: nextSignal.leverage,
            orderUsd: nextSignal.orderUsd,
            capitalPercent: nextSignal.capitalPercent,
          },
        });
      }

      void this.appLog.append('info', 'telegram', 'Перезаход обработан', {
        oldSignalId: prev.id,
        newSignalId: place.signalId,
        sourceChatId: params.chatId,
        sourceMessageId: rootSource.messageId,
        quotedMessageId: params.replyToMessageId,
        reentryMessageId: params.messageId,
      });

      return { ok: true, mode: 'replaced' };
    } finally {
      await this.bybit.resumeStaleReconcile(
        base.pair,
        base.direction,
        prev.cabinetId ?? null,
      );
    }
  }

  signalFromDb(prev: {
    pair: string;
    direction: string;
    entries: string;
    entryIsRange?: boolean;
    stopLoss: number;
    takeProfits: string;
    leverage: number;
    orderUsd: number;
    capitalPercent: number;
    source: string | null;
  }): SignalDto {
    const direction = prev.direction === 'short' ? 'short' : 'long';
    return {
      pair: prev.pair,
      direction,
      entries: parseSignalPriceArrayJson(prev.entries),
      entryIsRange: prev.entryIsRange === true,
      stopLoss: prev.stopLoss,
      takeProfits: parseSignalPriceArrayJson(prev.takeProfits),
      leverage: prev.leverage,
      orderUsd: prev.orderUsd,
      capitalPercent: prev.capitalPercent,
      source: prev.source ?? undefined,
    };
  }

  async tryCloseSignalFromReply(params: {
    chatId: string;
    messageId: string;
    replyToMessageId?: string;
    signalExternalId?: string;
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const replyToMessageId = params.replyToMessageId?.trim() || undefined;
    const signalExternalId = params.signalExternalId?.trim() || undefined;
    if (!replyToMessageId && !signalExternalId) {
      return {
        ok: false,
        error: 'Сообщение о закрытии без цитаты исходного сигнала и без SIGNAL ID',
      };
    }
    const lookup = await this.signalLookup.findActiveSignalFromReply({
      chatId: params.chatId,
      replyToMessageId,
      signalExternalId,
      flowLabel: 'Close',
    });
    if (!lookup.ok) {
      return { ok: false, error: lookup.error };
    }
    const rootSource = lookup.rootSource;
    const signal = lookup.signal;
    void this.appLog.append('debug', 'telegram', 'Close: resolved root source message', {
      sourceChatId: params.chatId,
      quotedMessageId: replyToMessageId,
      rootSourceMessageId: rootSource.messageId,
      quoteChain: rootSource.chain,
      matchedSignalMessageIds: rootSource.matchedSignalMessageIds,
      stopReason: rootSource.stopReason,
      signalId: signal.id,
    });

    const closeSignal = this.signalFromDb(signal);
    this.pairDirection.beginPairDirectionTransition(closeSignal.pair, closeSignal.direction, 'close flow');
    try {
      const closed = await this.bybit.closeSignalManually(signal.id);
      if (!closed.ok) {
        return {
          ok: false,
          error: closed.error ?? closed.details ?? 'Не удалось закрыть сделку на Bybit',
        };
      }
      this.pairDirection.setCloseCooldown(closeSignal.pair, closeSignal.direction);
      await this.orders.createSignalEvent(signal.id, 'CANCELLED_BY_CHAT', {
        reason: 'Сигнал отменен в чате (closed/cancel)',
        sourceChatId: params.chatId,
        sourceMessageId: rootSource.messageId,
        closeMessageId: params.messageId,
      });

      void this.appLog.append(
        'info',
        'telegram',
        'Сделка закрыта по сообщению closed с цитатой',
        {
          sourceChatId: params.chatId,
          sourceMessageId: rootSource.messageId,
          quotedMessageId: replyToMessageId,
          closeMessageId: params.messageId,
          signalId: signal.id,
        },
      );
      return { ok: true };
    } finally {
      this.pairDirection.endPairDirectionTransition(closeSignal.pair, closeSignal.direction);
    }
  }

  async tryNotifyResultWithoutEntryFromReply(params: {
    ingestId: string;
    chatId: string;
    messageId: string;
    text: string;
    replyToMessageId?: string;
    signalExternalId?: string;
    quotedText?: string;
  }): Promise<
    | {
        ok: true;
        mode:
          | 'result_without_entry_notified'
          | 'result_without_entry_cancelled'
          | 'result_ignored_has_entry'
          | 'result_ignored_duplicate'
          | 'result_notify_disabled';
        signalId?: string;
      }
    | { ok: false; error: string }
  > {
    const replyToMessageId = params.replyToMessageId?.trim() || undefined;
    const signalExternalId = params.signalExternalId?.trim() || undefined;
    if (!replyToMessageId && !signalExternalId) {
      return {
        ok: false,
        error: 'Сообщение о результате без цитаты исходного сигнала и без SIGNAL ID',
      };
    }
    const lookup = await this.signalLookup.findActiveSignalFromReply({
      chatId: params.chatId,
      replyToMessageId,
      signalExternalId,
      flowLabel: 'Result',
    });
    if (!lookup.ok) {
      return { ok: false, error: lookup.error };
    }
    const signal = await this.prisma.signal.findUnique({
      where: { id: lookup.signal.id },
      select: {
        id: true,
        pair: true,
        orders: {
          select: {
            orderKind: true,
            status: true,
          },
        },
      },
    });
    if (!signal) {
      return { ok: false, error: `Сигнал ${lookup.signal.id} не найден` };
    }
    if (this.hasFilledEntryOrders(signal.orders)) {
      return { ok: true, mode: 'result_ignored_has_entry', signalId: signal.id };
    }
    const priorResultEvents = await this.prisma.signalEvent.findMany({
      where: {
        signalId: signal.id,
        type: 'USERBOT_RESULT_WITHOUT_ENTRY',
      },
      select: { payload: true },
    });
    for (const row of priorResultEvents) {
      if (!row.payload) {
        continue;
      }
      try {
        const p = JSON.parse(row.payload) as {
          resultMessageId?: string;
          sourceChatId?: string;
        };
        if (
          p.resultMessageId === params.messageId &&
          (p.sourceChatId ?? '') === params.chatId
        ) {
          return { ok: true, mode: 'result_ignored_duplicate', signalId: signal.id };
        }
      } catch {
        // ignore malformed payload
      }
    }
    const notifyEnabled = await this.getBoolSetting(
      'TELEGRAM_USERBOT_NOTIFY_RESULT_WITHOUT_ENTRY',
      true,
    );
    if (!notifyEnabled) {
      return { ok: true, mode: 'result_notify_disabled', signalId: signal.id };
    }

    const chatMeta = await this.userbotSettings.getScopedChatMeta(params.chatId);
    const notify = await this.telegramBot.notifyUserbotResultWithoutEntry({
      ingestId: params.ingestId,
      chatId: params.chatId,
      groupTitle: chatMeta.title || undefined,
      pair: signal.pair,
      signalId: signal.id,
      resultMessageText: params.text,
      quotedSnippet: params.quotedText,
    });
    void this.vkNotifyMirror.mirrorNotifyUserbotResultWithoutEntry({
      ingestId: params.ingestId,
      chatId: params.chatId,
      groupTitle: chatMeta.title || undefined,
      pair: signal.pair,
      signalId: signal.id,
      resultMessageText: params.text,
      quotedSnippet: params.quotedText,
    });
    if (!notify.ok) {
      return {
        ok: false,
        error: notify.error ?? 'Не удалось отправить уведомление result без входа',
      };
    }
    await this.orders.createSignalEvent(signal.id, 'USERBOT_RESULT_WITHOUT_ENTRY', {
      sourceChatId: params.chatId,
      sourceMessageId: lookup.rootSource.messageId,
      resultMessageId: params.messageId,
      replyToMessageId,
      ingestId: params.ingestId,
    });
    const autoCancel = await this.getBoolSetting(
      'TELEGRAM_USERBOT_CANCEL_STALE_ORDERS_ON_RESULT_WITHOUT_ENTRY',
      false,
    );
    if (!autoCancel) {
      return { ok: true, mode: 'result_without_entry_notified', signalId: signal.id };
    }

    const closeSignal = this.signalFromDb(lookup.signal);
    this.pairDirection.beginPairDirectionTransition(
      closeSignal.pair,
      closeSignal.direction,
      'result stale cancel',
    );
    try {
      const closed = await this.bybit.closeSignalManually(signal.id);
      if (!closed.ok) {
        return {
          ok: false,
          error:
            closed.error ??
            closed.details ??
            'Не удалось отменить ордера для result без входа',
        };
      }
      this.pairDirection.setCloseCooldown(closeSignal.pair, closeSignal.direction);
      await this.orders.createSignalEvent(
        signal.id,
        'USERBOT_RESULT_WITHOUT_ENTRY_CANCELLED',
        {
          sourceChatId: params.chatId,
          sourceMessageId: lookup.rootSource.messageId,
          resultMessageId: params.messageId,
          ingestId: params.ingestId,
          reason: 'Автоматическая отмена ордеров: result получен без фактического входа',
        },
      );
      return { ok: true, mode: 'result_without_entry_cancelled', signalId: signal.id };
    } finally {
      this.pairDirection.endPairDirectionTransition(closeSignal.pair, closeSignal.direction);
    }
  }

  private hasFilledEntryOrders(
    orders: Array<{ orderKind: string; status: string | null }>,
  ): boolean {
    return orders.some((order) => {
      if (order.orderKind !== 'ENTRY' && order.orderKind !== 'DCA') {
        return false;
      }
      return (order.status ?? '').trim().toLowerCase() === 'filled';
    });
  }
}
