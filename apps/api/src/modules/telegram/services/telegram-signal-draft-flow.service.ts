import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { SignalDto, TranscriptResult } from '@repo/shared';
import { Context } from 'telegraf';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';
import {
  mergePartialSignals,
  sanitizeSignalSource,
} from '../../transcript/partial-signal.util';
import { TranscriptService } from '../../transcript/transcript.service';
import { BybitService } from '../../bybit/bybit.service';
import { BybitSpotService } from '../../bybit-spot/bybit-spot.service';
import {
  cancelOnlyKeyboard,
  confirmKeyboard,
  sourceSelectionKeyboard,
} from '../utils/telegram-keyboards.util';
import { normalizeDraftTurns } from '../utils/telegram-draft.util';
import {
  formatPartialPreview,
  formatSignalTable,
} from '../utils/telegram-signal-message-format.util';
import { TelegramConversationStateService } from './telegram-conversation-state.service';

@Injectable()
export class TelegramSignalDraftFlowService {
  private readonly logger = new Logger(TelegramSignalDraftFlowService.name);

  constructor(
    private readonly state: TelegramConversationStateService,
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => TranscriptService))
    private readonly transcript: TranscriptService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    @Inject(forwardRef(() => BybitSpotService))
    private readonly bybitSpot: BybitSpotService,
    private readonly appLog: AppLogService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  private async getResolvedDefaultOrderUsd(): Promise<number> {
    const d = await this.bybit.getUnifiedUsdtBalanceDetails();
    return this.settings.getDefaultOrderUsd(d?.totalUsd);
  }

  async buildTelegramTranscriptOverrides(): Promise<{ defaultOrderUsd: number }> {
    const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
    return { defaultOrderUsd };
  }

  /**
   * Итоговый источник сигнала: /source у пользователя → SIGNAL_SOURCE в настройках → из текста (если модель извлекла название канала).
   */
  private async resolveSourceForUser(
    userId: number,
    llmSource: string | undefined,
  ): Promise<string | undefined> {
    const o = this.state.sourceOverrideByUser.get(userId)?.trim();
    if (o) return o;
    const fromSettings = (await this.settings.get('SIGNAL_SOURCE'))?.trim();
    if (fromSettings) return fromSettings;
    return sanitizeSignalSource(llmSource);
  }

  async applySourceToSignal(userId: number, signal: SignalDto): Promise<void> {
    const resolved = await this.resolveSourceForUser(userId, signal.source);
    if (resolved) {
      signal.source = resolved;
    } else {
      delete signal.source;
    }
  }

  private async getDistinctSources(): Promise<string[]> {
    const cabinetId = this.currentCabinetId();
    const rows = await this.prisma.signal.findMany({
      where: { cabinetId, source: { not: null } },
      select: { source: true },
      distinct: ['source'],
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => r.source!).filter(Boolean);
  }

  async handleParseResult(
    ctx: Context,
    res: TranscriptResult,
    raw: string | undefined,
  ): Promise<void> {
    const uid = ctx.from?.id;
    if (!uid) return;

    if (res.ok === false) {
      this.logger.warn(
        `handleParseResult: parse failed userId=${uid} error=${res.error}`,
      );
      void this.appLog.append('warn', 'telegram', 'parse / transcript error', {
        userId: uid,
        error: res.error,
        details: res.details,
      });
      await ctx.reply(
        `Ошибка: ${res.error}${res.details ? `\n${res.details}` : ''}`,
      );
      return;
    }

    const prev = this.state.getActiveDraft(uid);
    const nextTurns = normalizeDraftTurns(
      raw ? [...(prev?.userTurns ?? []), raw] : (prev?.userTurns ?? []),
    );

    if (res.ok === 'incomplete') {
      const merged =
        prev?.phase === 'ready' && prev.signal
          ? mergePartialSignals(prev.signal, res.partial)
          : mergePartialSignals(prev?.partial, res.partial);

      this.state.drafts.set(uid, {
        phase: 'collecting',
        partial: merged,
        userTurns: nextTurns,
        updatedAtMs: Date.now(),
      });
      this.logger.log(
        `handleParseResult: incomplete draft userId=${uid} missing=${res.missing.join(',')}`,
      );
      void this.appLog.append('info', 'telegram', 'черновик: неполный сигнал', {
        userId: uid,
        missing: res.missing,
        prompt: res.prompt,
      });
      await ctx.reply(
        `${res.prompt}\n\n${formatPartialPreview(merged)}\n\n` +
          `Ответьте сообщением (можно голосом или фото). /cancel — отменить.`,
        cancelOnlyKeyboard(),
      );
      return;
    }

    const dup = await this.bybit.wouldDuplicateActivePairDirection(
      res.signal.pair,
      res.signal.direction,
    );
    if (dup) {
      this.logger.warn(
        `handleParseResult: duplicate pair+direction ${res.signal.pair} ${res.signal.direction} userId=${uid}`,
      );
      void this.appLog.append('warn', 'telegram', 'отклонено: дубликат пары и стороны', {
        userId: uid,
        pair: res.signal.pair,
        direction: res.signal.direction,
      });
      this.state.drafts.delete(uid);
      await ctx.reply(
        `По паре ${res.signal.pair.toUpperCase()} уже есть активный сигнал ${res.signal.direction.toUpperCase()} или открытая позиция/ордера в эту сторону. Повторный вход в ту же сторону недоступен.`,
      );
      return;
    }

    await this.applySourceToSignal(uid, res.signal);

    if (!res.signal.source) {
      const existingSources = await this.getDistinctSources();
      if (existingSources.length > 0) {
        this.state.drafts.set(uid, {
          phase: 'awaiting_source',
          signal: res.signal,
          userTurns: nextTurns,
          pendingSources: existingSources,
          updatedAtMs: Date.now(),
        });
        this.logger.log(
          `handleParseResult: awaiting_source userId=${uid} pair=${res.signal.pair} sources=${existingSources.length}`,
        );
        void this.appLog.append('info', 'telegram', 'черновик: выбор источника', {
          userId: uid,
          pair: res.signal.pair,
          sources: existingSources,
        });
        const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
        await ctx.reply(
          formatSignalTable(res.signal, defaultOrderUsd) +
            '\n\nВыберите источник сигнала или продолжите без него:',
          { ...sourceSelectionKeyboard(existingSources) },
        );
        return;
      }
    }

    this.state.drafts.set(uid, {
      phase: 'ready',
      signal: res.signal,
      userTurns: nextTurns,
      updatedAtMs: Date.now(),
    });
    this.logger.log(
      `handleParseResult: draft ready userId=${uid} pair=${res.signal.pair}`,
    );
    void this.appLog.append('info', 'telegram', 'черновик готов к подтверждению', {
      userId: uid,
      pair: res.signal.pair,
      direction: res.signal.direction,
      orderUsd: res.signal.orderUsd,
    });
    const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
    await ctx.reply(formatSignalTable(res.signal, defaultOrderUsd), {
      ...confirmKeyboard(),
    });
  }

  async confirmFromIngestId(ingestId: string): Promise<{
    ok: boolean;
    error?: string;
    placeErrorCode?: string;
    signalId?: string;
    bybitOrderIds?: string[];
  }> {
    const row = await this.prisma.tgUserbotIngest.findUnique({
      where: { id: ingestId },
      select: { text: true, chatId: true, messageId: true },
    });
    const text = row?.text?.trim();
    if (!text) {
      return { ok: false, error: 'Текст сообщения для подтверждения не найден' };
    }
    const cabinetId = this.cabinetContext.getCabinetId();
    const [chat, scopedChat, details] = await Promise.all([
      row?.chatId
        ? this.prisma.tgUserbotChat.findUnique({
            where: { chatId: row.chatId },
            select: {
              title: true,
              defaultLeverage: true,
              forcedLeverage: true,
              defaultEntryUsd: true,
            },
          })
        : Promise.resolve(null),
      row?.chatId && cabinetId
        ? this.prisma.cabinetTelegramSource.findUnique({
            where: {
              cabinetId_chatId: {
                cabinetId,
                chatId: row.chatId,
              },
            },
            select: {
              defaultLeverage: true,
              forcedLeverage: true,
              defaultEntryUsd: true,
            },
          })
        : Promise.resolve(null),
      this.bybit.getUnifiedUsdtBalanceDetails(),
    ]);
    const defaultOrderUsd = await this.settings.resolveDefaultEntryUsd({
      rawOverride: scopedChat?.defaultEntryUsd ?? chat?.defaultEntryUsd,
      balanceTotalUsd: details?.totalUsd,
    });
    const leverageDefault =
      scopedChat?.defaultLeverage != null && scopedChat.defaultLeverage >= 1
        ? scopedChat.defaultLeverage
        : chat?.defaultLeverage != null && chat.defaultLeverage >= 1
          ? chat.defaultLeverage
          : undefined;
    const chatForcedLeverage =
      scopedChat?.forcedLeverage != null && scopedChat.forcedLeverage >= 1
        ? scopedChat.forcedLeverage
        : chat?.forcedLeverage != null && chat.forcedLeverage >= 1
          ? chat.forcedLeverage
          : undefined;
    const parsed = await this.transcript.parse(
      'text',
      { text },
      { defaultOrderUsd, leverageDefault, chatForcedLeverage },
    );
    if (parsed.ok !== true) {
      return {
        ok: false,
        error:
          parsed.ok === false
            ? parsed.error
            : `Сигнал неполный: ${parsed.prompt}`,
      };
    }
    if (chat?.title) {
      parsed.signal.source = chat.title;
    }
    const routed = await this.bybitSpot.routeUserbotSignalPlacement({
      signal: parsed.signal,
      rawMessage: text,
      origin: {
        chatId: row?.chatId ?? undefined,
        messageId: row?.messageId ?? undefined,
      },
      ingestId,
    });
    if (routed.kind === 'spot_prompt') {
      return {
        ok: false,
        error: routed.message ?? 'Ожидает решение по споту в боте',
      };
    }
    if (routed.kind === 'blocked') {
      return { ok: false, error: formatError(routed.error) };
    }
    const place = routed.placement;
    if (!place.ok) {
      return {
        ok: false,
        error: formatError(place.error),
        placeErrorCode: place.errorCode,
      };
    }
    await this.prisma.tgUserbotIngest
      .update({
        where: { id: ingestId },
        data: { status: 'placed', error: null },
      })
      .catch(() => undefined);
    return {
      ok: true,
      signalId: place.signalId,
      bybitOrderIds: place.bybitOrderIds,
    };
  }
}
