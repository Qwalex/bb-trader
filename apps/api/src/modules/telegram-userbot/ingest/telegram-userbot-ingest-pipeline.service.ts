import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { SettingsService } from '../../settings/settings.service';
import { TranscriptService } from '../../transcript/transcript.service';
import { BybitService } from '../../bybit/bybit.service';
import { OrdersService } from '../../orders/orders.service';
import { TelegramService } from '../../telegram/services/telegram.service';
import { VkNotifyMirrorService } from '../../vk/vk-notify-mirror.service';
import { UserbotSignalHashService } from '../userbot-signal-hash.service';
import {
  CRITICAL_NOTIFY_URL,
  USERBOT_BALANCE_CHECK_CACHE_MS,
  USERBOT_INLINE_TEXT_MAX_CHARS,
  USERBOT_MIN_BALANCE_USD_DEFAULT,
} from '../telegram-userbot.constants';
import type { MessageKind, ProcessIngestOptions, UserbotFilterKind } from '../telegram-userbot.types';
import { TelegramUserbotFiltersService } from '../filters/telegram-userbot-filters.service';
import { TelegramUserbotIngestLevelsWatchService } from './telegram-userbot-ingest-levels-watch.service';
import { TelegramUserbotIngestPairDirectionService } from './telegram-userbot-ingest-pair-direction.service';
import { TelegramUserbotIngestSignalLookupService } from './telegram-userbot-ingest-signal-lookup.service';
import { TelegramUserbotIngestSignalReplyService } from './telegram-userbot-ingest-signal-reply.service';
import { TelegramUserbotIngestService } from './telegram-userbot-ingest.service';
import { TelegramUserbotMirrorService } from '../mirror/telegram-userbot-mirror.service';
import { TelegramUserbotSettingsService } from '../settings/telegram-userbot-settings.service';
import {
  countLockEmojiInText,
  extractTokenHint,
  makeTextPreview,
} from '../utils/telegram-userbot-text.util';
import {
  extractSignalExternalId,
  limitTrace,
  readString,
} from '../utils/telegram-userbot-parse.util';

@Injectable()
export class TelegramUserbotIngestPipelineService {
  private readonly logger = new Logger(TelegramUserbotIngestPipelineService.name);
  private readonly balanceCheckCacheByCabinet = new Map<
    string,
    {
      checkedAtMs: number;
      balanceUsd: number | undefined;
      totalBalanceUsd: number | undefined;
      minBalanceUsd: number;
    }
  >();
  private lastCriticalNotifyAtByKey = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
    private readonly transcript: TranscriptService,
    private readonly bybit: BybitService,
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly telegramBot: TelegramService,
    @Inject(forwardRef(() => VkNotifyMirrorService))
    private readonly vkNotifyMirror: VkNotifyMirrorService,
    private readonly userbotSignalHash: UserbotSignalHashService,
    private readonly ingest: TelegramUserbotIngestService,
    private readonly userbotSettings: TelegramUserbotSettingsService,
    private readonly userbotFilters: TelegramUserbotFiltersService,
    private readonly userbotMirror: TelegramUserbotMirrorService,
    private readonly levelsWatch: TelegramUserbotIngestLevelsWatchService,
    private readonly signalLookup: TelegramUserbotIngestSignalLookupService,
    private readonly pairDirection: TelegramUserbotIngestPairDirectionService,
    private readonly signalReply: TelegramUserbotIngestSignalReplyService,
  ) {}

  async processIngestRecord(
  ingest: {
    id: string;
    chatId: string;
    messageId: string;
    signalHash: string | null;
    status: string;
  },
  text: string,
  meta?: { replyToMessageId?: string; signalExternalId?: string },
  options?: ProcessIngestOptions,
): Promise<void> {
  try {
    const processingStartedAt = new Date();
    const queueDelayMs = options?.enqueuedAtMs
      ? Math.max(0, Date.now() - options.enqueuedAtMs)
      : 0;
    const cabinetId = this.cabinetContext.getCabinetId();
    const currentRoute = cabinetId
      ? await this.prisma.cabinetIngestRoute.findUnique({
          where: { cabinetId_ingestId: { cabinetId, ingestId: ingest.id } },
          select: { status: true },
        })
      : null;
    const currentIngest = await this.prisma.tgUserbotIngest.findUnique({
      where: { id: ingest.id },
      select: { status: true, signalHash: true },
    });
    if (currentRoute?.status === 'placed' || (!cabinetId && currentIngest?.status === 'placed')) {
      this.appendIngestStageLog('warn', 'Userbot: already placed ingest skipped', ingest, {
        source: options?.source ?? null,
        signalHash: currentIngest?.signalHash ?? ingest.signalHash,
        queueDelayMs,
        cabinetId: cabinetId ?? null,
      });
      return;
    }
    const effectiveCabinetId = cabinetId ?? (await this.cabinets.getDefaultCabinetId());
    this.appendIngestStageLog('debug', 'Userbot: processing started', ingest, {
      replyToMessageId: meta?.replyToMessageId ?? null,
      textPreview: makeTextPreview(text),
      source: options?.source ?? null,
      queueDelayMs,
      telegramReceivedAt: options?.telegramReceivedAt?.toISOString() ?? null,
      ingestCreatedAt: options?.ingestCreatedAt?.toISOString() ?? null,
      processingStartedAt: processingStartedAt.toISOString(),
      processingQueueDepth: this.ingest.getQueueDepth(),
      processingWorkersActive: this.ingest.getWorkersActive(),
    });
    await this.ingest.updateIngest(ingest.id, {
      classification: 'other',
      status: 'ignored',
      error: null,
      aiRequest: null,
      aiResponse: null,
    });

    if (options?.enforceBalanceGuard) {
      const lowBalance = await this.getLowBalanceGuardState();
      if (lowBalance.ignore) {
        this.appendIngestStageLog('warn', 'Userbot: skipped by low balance guard', ingest, {
          reason: lowBalance.reason ?? null,
        });
        await this.ingest.updateIngest(ingest.id, {
          classification: 'other',
          status: 'ignored',
          error: lowBalance.reason,
          aiRequest: null,
          aiResponse: null,
        });
        return;
      }
    }

    const lockEmojiCount = countLockEmojiInText(text);
    if (lockEmojiCount > 5) {
      const reason =
        'Сообщение содержит 🔐 более 5 раз — не обрабатывается как сигнал, результат, перезаход или закрытие';
      this.appendIngestStageLog('info', 'Userbot: skipped — lock emoji spam', ingest, {
        lockEmojiCount,
        textPreview: makeTextPreview(text),
      });
      await this.ingest.updateIngest(ingest.id, {
        classification: 'other',
        status: 'ignored',
        error: reason,
        aiRequest: null,
        aiResponse: null,
      });
      return;
    }

    const chatMeta = await this.userbotSettings.getScopedChatMeta(ingest.chatId);
    const groupName = chatMeta.title || ingest.chatId;
    const replyToMessageId = meta?.replyToMessageId?.trim() || undefined;
    const signalExternalId =
      meta?.signalExternalId?.trim() || extractSignalExternalId(text) || undefined;
    const hasQuotedSource = Boolean(replyToMessageId);
    const patternMatch = await this.userbotFilters.matchFilterKindByPatterns(
      groupName,
      text,
      hasQuotedSource,
    );
    const exampleMatch = patternMatch
      ? undefined
      : await this.userbotFilters.matchFilterKindByExamples(groupName, text, hasQuotedSource);
    const filterKind = patternMatch?.kind;
    const exampleKind = exampleMatch?.kind;
    if (patternMatch) {
      this.appendIngestStageLog('info', 'Userbot: matched filter pattern', ingest, {
        groupName,
        matchedKind: patternMatch.kind,
        matchedPattern: patternMatch.pattern,
        requiresQuote: patternMatch.requiresQuote,
        hasQuotedSource,
        textPreview: makeTextPreview(text),
      });
    }
    if (exampleMatch) {
      this.appendIngestStageLog('info', 'Userbot: matched filter example', ingest, {
        groupName,
        matchedKind: exampleMatch.kind,
        similarityScore: Number(exampleMatch.score.toFixed(4)),
        examplePreview: exampleMatch.examplePreview,
        requiresQuote: exampleMatch.requiresQuote,
        hasQuotedSource,
        textPreview: makeTextPreview(text),
      });
    }
    if (filterKind === 'ignore' || exampleKind === 'ignore') {
      const ignoreSource = filterKind === 'ignore' ? 'pattern' : 'example';
      this.appendIngestStageLog('info', 'Userbot: ignored by user filter', ingest, {
        groupName,
        ignoreSource,
        matchedPattern: patternMatch?.pattern ?? null,
        matchedExampleScore: exampleMatch ? Number(exampleMatch.score.toFixed(4)) : null,
        hasQuotedSource,
      });
      await this.ingest.updateIngest(ingest.id, {
        classification: 'other',
        status: 'ignored',
        error:
          ignoreSource === 'pattern'
            ? 'Игнор по пользовательскому фильтр-паттерну'
            : 'Игнор по пользовательскому фильтр-примеру',
        aiRequest: limitTrace(
          JSON.stringify({
            operation: 'classifyMessage',
            source: ignoreSource === 'pattern' ? 'group_filter_pattern' : 'group_filter_example',
            groupName,
            preferredKind: 'ignore',
          }),
        ),
        aiResponse: limitTrace(
          JSON.stringify({
            forcedKind: 'ignore',
            reason:
              ignoreSource === 'pattern'
                ? 'matched by user ignore pattern for group'
                : 'matched by user ignore examples for group',
          }),
        ),
      });
      return;
    }

    const useAiClassifier = await this.getBoolSetting(
      'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
      true,
    );
    const quotedText = replyToMessageId
      ? await this.signalLookup.fetchChatMessageText(ingest.chatId, replyToMessageId)
      : undefined;
    const cls = await this.classifyMessage(
      text,
      useAiClassifier,
      filterKind ?? exampleKind,
      filterKind ? 'group_filter_pattern' : exampleKind ? 'group_filter_example' : undefined,
      groupName,
      replyToMessageId,
      quotedText,
      ingest.chatId,
      ingest.id,
    );
    let kind = cls.kind;
    const aiRequest = cls.aiRequest;
    let aiResponse = cls.aiResponse;
    let ignoredOtherError: string | null = null;
    if (!hasQuotedSource && !signalExternalId && (kind === 'close' || kind === 'reentry')) {
      const previousKind = kind;
      kind = 'other';
      ignoredOtherError =
        previousKind === 'reentry'
          ? 'Reentry-сообщение без цитаты исходного сигнала'
          : 'Close-сообщение без цитаты исходного сигнала';
      this.appendIngestStageLog('warn', 'Userbot: close/reentry сняты — нет цитаты', ingest, {
        previousKind,
        filterKind: filterKind ?? null,
        exampleKind: exampleKind ?? null,
      });
      const note = limitTrace(
        JSON.stringify({
          note: 'close/reentry недопустимы без reply; классификация сброшена в other',
          previousKind,
        }),
      );
      aiResponse = aiResponse ? `${aiResponse}\n${note}` : note;
    }
    this.appendIngestStageLog('info', 'Userbot: classification resolved', ingest, {
      groupName,
      filterKind: filterKind ?? null,
      exampleKind: exampleKind ?? null,
      matchedPattern: patternMatch?.pattern ?? null,
      matchedExampleScore: exampleMatch ? Number(exampleMatch.score.toFixed(4)) : null,
      matchedPatternRequiresQuote: patternMatch?.requiresQuote ?? null,
      matchedExampleRequiresQuote: exampleMatch?.requiresQuote ?? null,
      useAiClassifier,
      kind,
      hasQuotedSource,
      replyToMessageId: replyToMessageId ?? null,
      signalExternalId: signalExternalId ?? null,
      classifiedAt: new Date().toISOString(),
      processingElapsedMs: Date.now() - processingStartedAt.getTime(),
    });

    if (kind === 'reentry') {
      const reentry = await this.signalReply.tryReentryFromReply({
        chatId: ingest.chatId,
        messageId: ingest.messageId,
        text,
        replyToMessageId,
        signalExternalId,
      });
      this.appendIngestStageLog(
        reentry.ok ? 'info' : 'warn',
        'Userbot: reentry processing finished',
        ingest,
        reentry.ok
          ? { mode: reentry.mode, replyToMessageId }
          : { error: reentry.error, replyToMessageId },
      );
      await this.ingest.updateIngest(ingest.id, {
        classification: 'signal',
        status: reentry.ok
          ? reentry.mode === 'updated'
            ? 'reentry_updated'
            : 'reentry_placed'
          : 'ignored',
        error: reentry.ok ? null : reentry.error,
        aiRequest,
        aiResponse,
      });
      return;
    }

    if (kind === 'close') {
      const closeResult = await this.signalReply.tryCloseSignalFromReply({
        chatId: ingest.chatId,
        messageId: ingest.messageId,
        replyToMessageId,
        signalExternalId,
      });
      this.appendIngestStageLog(
        closeResult.ok ? 'info' : 'warn',
        'Userbot: close processing finished',
        ingest,
        closeResult.ok ? { replyToMessageId } : { error: closeResult.error, replyToMessageId },
      );
      await this.ingest.updateIngest(ingest.id, {
        classification: 'result',
        status: closeResult.ok ? 'closed_by_reply' : 'ignored',
        error: closeResult.ok ? null : closeResult.error,
        aiRequest,
        aiResponse,
      });
      if (closeResult.ok) {
        let rootSourceMessageId: string | undefined;
        if (replyToMessageId) {
          try {
            const root = await this.signalLookup.resolveRootSignalSourceMessageId(
              ingest.chatId,
              replyToMessageId,
            );
            rootSourceMessageId = root.messageId;
          } catch {
            // ignore root lookup errors for mirror publish
          }
        }
        await this.userbotMirror.publishOutcomeToMirrorGroups({
          ingest: { id: ingest.id, chatId: ingest.chatId, messageId: ingest.messageId },
          kind: 'cancel',
          text,
          rootSourceMessageId,
        });
      }
      return;
    }

    if (kind === 'result') {
      const resultNotify = await this.signalReply.tryNotifyResultWithoutEntryFromReply({
        ingestId: ingest.id,
        chatId: ingest.chatId,
        messageId: ingest.messageId,
        text,
        replyToMessageId,
        signalExternalId,
        quotedText,
      });
      this.appendIngestStageLog(
        resultNotify.ok ? 'info' : 'warn',
        'Userbot: result processing finished',
        ingest,
        resultNotify.ok
          ? { mode: resultNotify.mode, signalId: resultNotify.signalId ?? null, replyToMessageId }
          : { error: resultNotify.error, replyToMessageId },
      );
      await this.ingest.updateIngest(ingest.id, {
        classification: 'result',
        status: resultNotify.ok ? resultNotify.mode : 'ignored',
        error: resultNotify.ok ? null : resultNotify.error,
        aiRequest,
        aiResponse,
      });
      if (resultNotify.ok) {
        let rootSourceMessageId: string | undefined;
        if (replyToMessageId) {
          try {
            const root = await this.signalLookup.resolveRootSignalSourceMessageId(
              ingest.chatId,
              replyToMessageId,
            );
            rootSourceMessageId = root.messageId;
          } catch {
            // ignore root lookup errors for mirror publish
          }
        }
        await this.userbotMirror.publishOutcomeToMirrorGroups({
          ingest: { id: ingest.id, chatId: ingest.chatId, messageId: ingest.messageId },
          kind: 'result',
          text,
          rootSourceMessageId,
        });
      }
      return;
    }

    if (kind !== 'signal') {
      this.appendIngestStageLog('info', 'Userbot: ignored after classification', ingest, {
        classification: kind,
      });
      await this.ingest.updateIngest(ingest.id, {
        classification: kind,
        status: 'ignored',
        error: ignoredOtherError,
        aiRequest,
        aiResponse,
      });
      return;
    }

    this.appendIngestStageLog('debug', 'Userbot: parse started', ingest, {
      kind,
    });
    const parseOverrides = await this.userbotSettings.buildTranscriptParseOverrides(ingest.chatId);
    const parsed = await this.transcript.parse(
      'text',
      {
        text,
        openrouterLogContext: {
          chatId: ingest.chatId,
          source: groupName,
          ingestId: ingest.id,
          stage: 'parse',
        },
      },
      parseOverrides,
    );
    if (parsed.ok !== true) {
      const parseError = parsed.ok === false ? parsed.error : parsed.prompt;
      this.appendIngestStageLog('warn', 'Userbot: parse did not produce a signal', ingest, {
        parseStatus: parsed.ok,
        error: parseError,
      });
      await this.ingest.updateIngest(ingest.id, {
        classification: parsed.ok === 'incomplete' ? 'other' : 'signal',
        status: parsed.ok === 'incomplete' ? 'ignored' : 'parse_error',
        error: parseError,
        aiRequest,
        aiResponse,
      });
      await this.notifySignalFailureToBot({
        ingestId: ingest.id,
        chatId: ingest.chatId,
        token: extractTokenHint(text),
        stage: 'transcript',
        error: parseError,
        missingData:
          parsed.ok === 'incomplete'
            ? this.extractMissingFieldsFromPrompt(parsed.prompt)
            : undefined,
      });
      return;
    }

    const signal = parsed.signal;
    signal.source = chatMeta?.title ?? undefined;
    await this.userbotMirror.publishSignalToMirrorGroups({
      ingest: { id: ingest.id, chatId: ingest.chatId, messageId: ingest.messageId },
      signal,
      sourceChatTitle: chatMeta?.title ?? undefined,
    });
    this.appendIngestStageLog('info', 'Userbot: parse produced signal', ingest, {
      pair: signal.pair,
      direction: signal.direction,
      entriesCount: signal.entries.length,
      takeProfitsCount: signal.takeProfits.length,
      leverage: signal.leverage,
      parsedAt: new Date().toISOString(),
      processingElapsedMs: Date.now() - processingStartedAt.getTime(),
    });
    const transitionWait = await this.pairDirection.waitForPairDirectionTransitionIfAny(
      effectiveCabinetId,
      signal.pair,
      signal.direction,
    );
    if (transitionWait.waited) {
      this.appendIngestStageLog(
        transitionWait.timedOut ? 'warn' : 'info',
        'Userbot: waited for pair/direction transition before duplicate check',
        ingest,
        {
          pair: signal.pair,
          direction: signal.direction,
          timedOut: transitionWait.timedOut,
          waitedMs: transitionWait.waitedMs,
        },
      );
    }
    const closeCooldownMs = this.pairDirection.getCloseCooldownRemainingMs(
      effectiveCabinetId,
      signal.pair,
      signal.direction,
    );
    if (closeCooldownMs > 0) {
      this.appendIngestStageLog(
        'warn',
        'Userbot: blocked by close cooldown',
        ingest,
        {
          pair: signal.pair,
          direction: signal.direction,
          cooldownMsRemaining: closeCooldownMs,
        },
      );
      await this.ingest.updateIngest(ingest.id, {
        classification: 'signal',
        status: 'duplicate_signal',
        error: `Повторный вход по ${signal.pair} (${signal.direction}) временно заблокирован после close (${Math.ceil(
          closeCooldownMs / 1000,
        )}s)`,
        aiRequest,
        aiResponse,
      });
      return;
    }

    if (
      await this.bybit.wouldDuplicateActivePairDirection(
        signal.pair,
        signal.direction,
      )
    ) {
      const incomingSourceName = (chatMeta?.title ?? ingest.chatId).trim();
      const incomingPriority = this.userbotSettings.normalizeSourcePriority(chatMeta?.sourcePriority);
      const activeSignal = await this.signalLookup.findActiveSignalForPairAndDirection(
        signal.pair,
        signal.direction,
      );

      if (activeSignal) {
        const activeSource = await this.signalLookup.resolveSourcePriorityForSignal(activeSignal);
        if (incomingPriority > activeSource.priority) {
          this.appendIngestStageLog(
            'warn',
            'Userbot: replacing active signal by source priority',
            ingest,
            {
              pair: signal.pair,
              direction: signal.direction,
              incomingSourceName,
              incomingPriority,
              replacedSignalId: activeSignal.id,
              replacedSourceName: activeSource.sourceName,
              replacedPriority: activeSource.priority,
            },
          );
          const closed = await this.bybit.closeSignalManually(activeSignal.id);
          if (!closed.ok) {
            await this.ingest.updateIngest(ingest.id, {
              classification: 'signal',
              status: 'duplicate_signal',
              error: `Более приоритетный источник ${incomingSourceName} (${incomingPriority}) найден, но отмена предыдущего сигнала не удалась: ${closed.error ?? 'unknown'}`,
              aiRequest,
              aiResponse,
            });
            return;
          }
          const reasonText = `сигнал отменен по преоритету - ${incomingPriority} (${incomingSourceName})`;
          await this.orders.createSignalEvent(
            activeSignal.id,
            'SIGNAL_CANCELLED_BY_SOURCE_PRIORITY',
            {
              reason: reasonText,
              incomingSourceName,
              incomingPriority,
              replacedSourceName: activeSource.sourceName,
              replacedPriority: activeSource.priority,
              replacedBySignal: {
                sourceChatId: ingest.chatId,
                sourceMessageId: ingest.messageId,
                pair: signal.pair,
                direction: signal.direction,
              },
            },
          );
          this.appendIngestStageLog(
            'info',
            'Userbot: previous signal cancelled by higher-priority source',
            ingest,
            {
              replacedSignalId: activeSignal.id,
              incomingSourceName,
              incomingPriority,
              replacedSourceName: activeSource.sourceName,
              replacedPriority: activeSource.priority,
            },
          );
        } else {
          this.appendIngestStageLog(
            'warn',
            'Userbot: duplicate blocked by source priority',
            ingest,
            {
              pair: signal.pair,
              direction: signal.direction,
              incomingSourceName,
              incomingPriority,
              activeSignalId: activeSignal.id,
              activeSourceName: activeSource.sourceName,
              activePriority: activeSource.priority,
            },
          );
          await this.ingest.updateIngest(ingest.id, {
            classification: 'signal',
            status: 'duplicate_signal',
            error: `Активный сигнал по паре ${signal.pair} (${signal.direction}) имеет приоритет ${activeSource.priority} (${activeSource.sourceName ?? 'неизвестный источник'}), входящий источник ${incomingSourceName} с приоритетом ${incomingPriority} отклонен`,
            aiRequest,
            aiResponse,
          });
          return;
        }
      } else {
        this.appendIngestStageLog('warn', 'Userbot: duplicate active pair/direction', ingest, {
          pair: signal.pair,
          direction: signal.direction,
        });
        await this.ingest.updateIngest(ingest.id, {
          classification: 'signal',
          status: 'duplicate_signal',
          error: `Активная позиция/сигнал по паре ${signal.pair} (${signal.direction})`,
          aiRequest,
          aiResponse,
        });
        return;
      }
    }

    const signalHash = this.userbotSignalHash.computeHash(signal);
    const canReuseExistingHash =
      ingest.signalHash === signalHash && ingest.status !== 'placed';
    const isNewSignal = canReuseExistingHash
      ? true
      : await this.userbotSignalHash.tryCreate(signalHash);
    if (!isNewSignal) {
      this.appendIngestStageLog('warn', 'Userbot: duplicate signal hash', ingest, {
        signalHash,
        pair: signal.pair,
        direction: signal.direction,
      });
      await this.ingest.updateIngest(ingest.id, {
        classification: 'signal',
        status: 'duplicate_signal',
        signalHash,
        error: 'Сигнал уже обрабатывался ранее',
        aiRequest,
        aiResponse,
      });
      return;
    }

    const requireConfirmationSetting = await this.getBoolSetting(
      'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION',
      false,
    );
    const requireConfirmation =
      requireConfirmationSetting && options?.bypassConfirmationForAutoRetry !== true;
    if (requireConfirmationSetting && options?.bypassConfirmationForAutoRetry === true) {
      this.appendIngestStageLog(
        'info',
        'Userbot: подтверждение в боте пропущено (автоповтор после правки сообщения)',
        ingest,
      );
    }
    if (requireConfirmation) {
      this.appendIngestStageLog('info', 'Userbot: waiting external confirmation', ingest, {
        signalHash,
        pair: signal.pair,
        direction: signal.direction,
      });
      await this.ingest.updateIngest(ingest.id, {
        classification: 'signal',
        status: 'blocked_by_setting',
        signalHash,
        error:
          'Авторазмещение отключено настройкой TELEGRAM_USERBOT_REQUIRE_CONFIRMATION=true',
        aiRequest,
        aiResponse,
      });
      const onExternalConfirmResult = async (result: {
        decision: 'confirmed' | 'rejected';
        ok: boolean;
        error?: string;
        placeErrorCode?: string;
        signalId?: string;
        bybitOrderIds?: string[];
        actorUserId?: number;
      }) => {
        if (result.decision === 'rejected') {
          this.appendIngestStageLog('info', 'Userbot: confirmation rejected by user', ingest, {
            actorUserId: result.actorUserId ?? null,
          });
          await this.ingest.updateIngest(ingest.id, {
            status: 'cancelled_by_confirmation',
            error: `Отклонено пользователем ${result.actorUserId ?? ''}`.trim(),
          });
          return;
        }
        if (!result.ok) {
          this.appendIngestStageLog('error', 'Userbot: confirmation accepted but placement failed', ingest, {
            error: result.error ?? 'unknown',
            placeErrorCode: result.placeErrorCode ?? null,
          });
          await this.ingest.updateIngest(ingest.id, {
            status: 'place_error',
            error:
              result.error ??
              'Подтверждение получено, но ордер не удалось выставить',
          });
          if (result.placeErrorCode === 'signal_levels_validation') {
            this.levelsWatch.scheduleSignalLevelsValidationEditWatch(ingest.id);
          }
          return;
        }
        this.appendIngestStageLog('info', 'Userbot: confirmation accepted and placement succeeded', ingest, {
          actorUserId: result.actorUserId ?? null,
        });
        await this.ingest.updateIngest(ingest.id, {
          status: 'placed',
          error: null,
        });
      };
      const req = await this.telegramBot.requestExternalSignalConfirmation({
        ingestId: ingest.id,
        signal,
        rawMessage: text,
        onResult: onExternalConfirmResult,
      });
      void this.vkNotifyMirror.mirrorRequestExternalSignalConfirmation({
        ingestId: ingest.id,
        signal,
        rawMessage: text,
        onResult: onExternalConfirmResult,
      });
      if (!req.ok) {
        this.appendIngestStageLog('warn', 'Userbot: failed to send confirmation request', ingest, {
          error: req.error ?? null,
        });
        await this.ingest.updateIngest(ingest.id, {
          error: `Ожидание подтверждения: ${req.error ?? 'не удалось отправить запрос в бот'}`,
        });
      } else {
        this.appendIngestStageLog('info', 'Userbot: confirmation request sent', ingest, {
          deliveredTo: req.deliveredTo,
        });
        await this.ingest.updateIngest(ingest.id, {
          error: `Ожидает подтверждение в боте (доставлено: ${req.deliveredTo})`,
        });
      }
      return;
    }

    this.appendIngestStageLog('info', 'Userbot: placing signal on Bybit', ingest, {
      pair: signal.pair,
      direction: signal.direction,
      signalHash,
    });
    const place = await this.bybit.placeSignalOrders(signal, text, {
      chatId: ingest.chatId,
      messageId: ingest.messageId,
      signalExternalId,
    });
    if (!place.ok) {
      const placeError = formatError(place.error);
      this.appendIngestStageLog('error', 'Userbot: Bybit placement failed', ingest, {
        pair: signal.pair,
        direction: signal.direction,
        signalHash,
        error: placeError,
      });
      await this.ingest.updateIngest(ingest.id, {
        classification: 'signal',
        status: 'place_error',
        signalHash,
        error: placeError,
        aiRequest,
        aiResponse,
      });
      const suppressNotify =
        options?.suppressPlacementFailureExternalNotify === true &&
        place.errorCode === 'signal_levels_validation';
      if (!suppressNotify) {
        await this.notifySignalFailureToBot({
          ingestId: ingest.id,
          chatId: ingest.chatId,
          token: signal.pair,
          stage: 'bybit',
          error: placeError,
        });
        await this.notifyCriticalExternalApiUnavailable('bybit', {
          ingestId: ingest.id,
          chatId: ingest.chatId,
          stage: 'bybit',
          error: placeError,
        });
      }
      if (place.errorCode === 'signal_levels_validation') {
        this.levelsWatch.scheduleSignalLevelsValidationEditWatch(ingest.id);
      }
      return;
    }

    this.appendIngestStageLog('info', 'Userbot: Bybit placement succeeded', ingest, {
      pair: signal.pair,
      direction: signal.direction,
      signalHash,
      signalId: place.signalId,
      bybitOrderIds: place.bybitOrderIds,
      placedAt: new Date().toISOString(),
      totalProcessingMs: Date.now() - processingStartedAt.getTime(),
    });
    await this.ingest.updateIngest(ingest.id, {
      classification: 'signal',
      status: 'placed',
      signalHash,
      aiRequest,
      aiResponse,
    });
    void this.appLog.append('info', 'telegram', 'Сигнал размещен автоматически', {
      pair: signal.pair,
      signalId: place.signalId,
      bybitOrderIds: place.bybitOrderIds,
      source: signal.source,
    });
  } catch (e) {
    const err = formatError(e);
    const isCriticalClassify = err.startsWith('CRITICAL_CLASSIFY:');
    const normalizedErr = isCriticalClassify
      ? err.replace(/^CRITICAL_CLASSIFY:\s*/, '')
      : err;
    this.appendIngestStageLog('error', 'Userbot: pipeline exception', ingest, {
      error: normalizedErr,
    });
    await this.ingest.updateIngest(ingest.id, {
      status: 'parse_error',
      error: normalizedErr,
    });
    if (!isCriticalClassify) {
      await this.notifySignalFailureToBot({
        ingestId: ingest.id,
        chatId: ingest.chatId,
        token: extractTokenHint(text),
        stage: 'transcript',
        error: normalizedErr,
      });
    }
    if (!isCriticalClassify) {
      const lowered = normalizedErr.toLowerCase();
      const criticalApi: 'bybit' | 'openrouter' =
        lowered.includes('bybit') ? 'bybit' : 'openrouter';
      await this.notifyCriticalExternalApiUnavailable(criticalApi, {
        ingestId: ingest.id,
        chatId: ingest.chatId,
        stage: criticalApi === 'bybit' ? 'bybit' : 'transcript',
        error: normalizedErr,
      });
    }
  }
}

  clearAllSignalLevelsValidationWatches(): void {
    this.levelsWatch.clearAllSignalLevelsValidationWatches();
  }

  async fetchChatMessageMeta(
    chatId: string,
    messageId: string,
  ): Promise<{ text?: string; replyToMessageId?: string; error?: string }> {
    return this.signalLookup.fetchChatMessageMeta(chatId, messageId);
  }

  /**
   * Недавние записи userbot-ingest для ручной привязки сделки (chat id + message id).
   * Все сообщения из ingest, без отбора по classification/status; опционально только chatId.
   */
  async listIngestLinkCandidates(options: {
    limit?: number;
    chatId?: string;
  }): Promise<{
    items: Array<{
      ingestId: string;
      chatId: string;
      messageId: string;
      chatTitle: string;
      textPreview: string;
      classification: string;
      status: string;
      createdAt: string;
    }>;
  }> {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const chatIdFilter = options.chatId?.trim();

    const rows = await this.prisma.tgUserbotIngest.findMany({
      where: chatIdFilter ? { chatId: chatIdFilter } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        chatId: true,
        messageId: true,
        text: true,
        classification: true,
        status: true,
        createdAt: true,
      },
    });

    const chatIds = Array.from(new Set(rows.map((r) => r.chatId)));
    const chats = await this.prisma.tgUserbotChat.findMany({
      where: { chatId: { in: chatIds } },
      select: { chatId: true, title: true },
    });
    const titleByChat = new Map(chats.map((c) => [c.chatId, c.title]));

    const preview = (t: string | null | undefined): string => {
      const s = (t ?? '').replace(/\s+/g, ' ').trim();
      if (s.length <= 220) return s;
      return `${s.slice(0, 220)}…`;
    };

    return {
      items: rows.map((r) => ({
        ingestId: r.id,
        chatId: r.chatId,
        messageId: r.messageId,
        chatTitle: titleByChat.get(r.chatId) ?? r.chatId,
        textPreview: preview(r.text),
        classification: r.classification,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  async rereadIngestMessage(ingestId: string) {
    const ingest = await this.prisma.tgUserbotIngest.findUnique({
      where: { id: ingestId },
      select: {
        id: true,
        chatId: true,
        messageId: true,
        text: true,
        signalHash: true,
        status: true,
        createdAt: true,
      },
    });
    if (!ingest) {
      return { ok: false, error: 'Сообщение не найдено' };
    }
    const fresh = await this.fetchChatMessageMeta(ingest.chatId, ingest.messageId);
    let text = readString(ingest.text) ?? '';
    let meta: { replyToMessageId?: string; signalExternalId?: string } | undefined;

    if (!fresh.error && fresh.text?.trim()) {
      text = fresh.text.trim();
      meta = {
        replyToMessageId: fresh.replyToMessageId,
        signalExternalId: extractSignalExternalId(text),
      };
      await this.prisma.tgUserbotIngest.update({
        where: { id: ingest.id },
        data: { text },
      });
    } else if (fresh.error) {
      this.logger.warn(
        `rereadIngestMessage: не удалось загрузить из Telegram (${fresh.error}), используется текст из БД`,
      );
    }

    if (!text.trim()) {
      return { ok: false, error: 'В сообщении нет текстового содержимого для перечитывания' };
    }
    const trimmed = text.trim();
    if (!meta) {
      meta = { signalExternalId: extractSignalExternalId(trimmed) };
    }

    const cabinetIds = await this.cabinets.listEnabledCabinetIdsForChat(ingest.chatId);
    for (const cabinetId of cabinetIds) {
      const route = await this.prisma.cabinetIngestRoute.upsert({
        where: { cabinetId_ingestId: { cabinetId, ingestId: ingest.id } },
        create: {
          cabinetId,
          ingestId: ingest.id,
          chatId: ingest.chatId,
          classification: 'other',
          status: 'queued',
        },
        update: {
          chatId: ingest.chatId,
          classification: 'other',
          status: 'queued',
          error: null,
          aiRequest: null,
          aiResponse: null,
        },
        select: { id: true, cabinetId: true },
      });
      this.ingest.enqueueIngestJob({
        ingest: {
          id: ingest.id,
          chatId: ingest.chatId,
          messageId: ingest.messageId,
          signalHash: null,
          status: ingest.status,
        },
        text: trimmed.length > USERBOT_INLINE_TEXT_MAX_CHARS ? null : trimmed,
        textLen: trimmed.length,
        meta,
        options: {
          enforceBalanceGuard: true,
          source: 'manual-reread',
          ingestCreatedAt: ingest.createdAt,
        },
        route,
      });
    }
    return { ok: true };
  }

  async rereadAllIngestMessages(limitRaw?: number) {
    const limit =
      typeof limitRaw === 'number' && Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(500, Math.floor(limitRaw)))
        : 80;
    const rows = await this.prisma.tgUserbotIngest.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        chatId: true,
        messageId: true,
        text: true,
        signalHash: true,
        status: true,
        createdAt: true,
      },
    });
    let processed = 0;
    let skippedWithoutText = 0;
    let failed = 0;
    const errors: Array<{ ingestId: string; error: string }> = [];

    for (const row of rows) {
      const fresh = await this.fetchChatMessageMeta(row.chatId, row.messageId);
      let text = readString(row.text) ?? '';
      let meta: { replyToMessageId?: string; signalExternalId?: string } | undefined;

      if (!fresh.error && fresh.text?.trim()) {
        text = fresh.text.trim();
        meta = {
          replyToMessageId: fresh.replyToMessageId,
          signalExternalId: extractSignalExternalId(text),
        };
        await this.prisma.tgUserbotIngest.update({
          where: { id: row.id },
          data: { text },
        });
      } else if (fresh.error) {
        this.logger.warn(
          `rereadAllIngestMessages: chat=${row.chatId} msg=${row.messageId} telegram=${fresh.error}, БД`,
        );
      }

      if (!text.trim()) {
        skippedWithoutText += 1;
        continue;
      }
      const trimmed = text.trim();
      if (!meta) {
        meta = { signalExternalId: extractSignalExternalId(trimmed) };
      }
      try {
        const cabinetIds = await this.cabinets.listEnabledCabinetIdsForChat(row.chatId);
        for (const cabinetId of cabinetIds) {
          const route = await this.prisma.cabinetIngestRoute.upsert({
            where: { cabinetId_ingestId: { cabinetId, ingestId: row.id } },
            create: {
              cabinetId,
              ingestId: row.id,
              chatId: row.chatId,
              classification: 'other',
              status: 'queued',
            },
            update: {
              chatId: row.chatId,
              classification: 'other',
              status: 'queued',
              error: null,
              aiRequest: null,
              aiResponse: null,
            },
            select: { id: true, cabinetId: true },
          });
          this.ingest.enqueueIngestJob({
            ingest: {
              id: row.id,
              chatId: row.chatId,
              messageId: row.messageId,
              signalHash: null,
              status: row.status,
            },
            text: trimmed.length > USERBOT_INLINE_TEXT_MAX_CHARS ? null : trimmed,
            textLen: trimmed.length,
            meta,
            options: {
              enforceBalanceGuard: true,
              source: 'manual-reread-all',
              ingestCreatedAt: row.createdAt,
            },
            route,
          });
        }
        processed += 1;
      } catch (e) {
        failed += 1;
        errors.push({ ingestId: row.id, error: formatError(e) });
      }
    }

    return {
      ok: true,
      total: rows.length,
      limit,
      processed,
      skippedWithoutText,
      failed,
      errors: errors.slice(0, 20),
      hasMore: rows.length >= limit,
    };
  }

  private isEntryCloseEnough(
  fromQuoted: number | undefined,
  fromDb: number | undefined,
): boolean {
  if (!Number.isFinite(fromQuoted) || !Number.isFinite(fromDb)) {
    return false;
  }
  const q = Number(fromQuoted);
  const d = Number(fromDb);
  const diff = Math.abs(q - d);
  const base = Math.max(Math.abs(d), 1);
  return diff / base <= 0.01;
}

  private extractMissingFieldsFromPrompt(prompt?: string): string[] | undefined {
  if (!prompt) {
    return undefined;
  }
  const parts = prompt
    .split(/[,\n;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x) => x.length <= 64);
  if (parts.length === 0) {
    return undefined;
  }
  return Array.from(new Set(parts)).slice(0, 8);
}

  private appendIngestStageLog(
  level: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  ingest: { id: string; chatId: string; messageId: string },
  payload?: Record<string, unknown>,
): void {
  void this.appLog.append(level, 'telegram', message, {
    ingestId: ingest.id,
    chatId: ingest.chatId,
    messageId: ingest.messageId,
    ...payload,
  });
}

  private async notifySignalFailureToBot(params: {
  ingestId: string;
  chatId: string;
  token: string;
  stage: 'classify' | 'transcript' | 'bybit';
  error: string;
  missingData?: string[];
}): Promise<void> {
  const enabled = await this.getBoolSetting(
    'TELEGRAM_USERBOT_NOTIFY_FAILURES',
    true,
  );
  if (!enabled) {
    return;
  }
  const chatMeta = await this.userbotSettings.getScopedChatMeta(params.chatId);
  const groupTitle = chatMeta.title;
  const notify = await this.telegramBot.notifyUserbotSignalFailure({
    ...params,
    groupTitle: groupTitle && groupTitle.length > 0 ? groupTitle : undefined,
  });
  void this.vkNotifyMirror.mirrorNotifyUserbotSignalFailure({
    ...params,
    groupTitle: groupTitle && groupTitle.length > 0 ? groupTitle : undefined,
  });
  if (!notify.ok) {
    this.logger.warn(
      `Failed to notify bot about signal error ingestId=${params.ingestId}: ${notify.error ?? 'unknown'}`,
    );
    await this.notifyCriticalExternalApiUnavailable('telegram', {
      ingestId: params.ingestId,
      chatId: params.chatId,
      stage: params.stage,
      error: notify.error ?? 'notifyUserbotSignalFailure failed',
    });
  }
}

  private isLikelyApiUnavailable(errorText: string, api: 'openrouter' | 'bybit' | 'telegram'): boolean {
  const t = errorText.toLowerCase();
  const common =
    t.includes('timeout') ||
    t.includes('timed out') ||
    t.includes('econnrefused') ||
    t.includes('enotfound') ||
    t.includes('eai_again') ||
    t.includes('fetch failed') ||
    t.includes('socket hang up') ||
    t.includes('network error') ||
    t.includes('service unavailable') ||
    t.includes('bad gateway') ||
    t.includes('gateway timeout') ||
    t.includes('internal server error') ||
    t.includes('status 5');
  if (api === 'openrouter') {
    return common || t.includes('openrouter недоступен') || t.includes('openrouter');
  }
  if (api === 'bybit') {
    return common || t.includes('bybit unavailable') || t.includes('bybit');
  }
  return common || t.includes('telegram bot не запущен') || t.includes('telegram_whitelist пуст');
}

  private async notifyCriticalExternalApiUnavailable(
  api: 'openrouter' | 'bybit' | 'telegram',
  params: { ingestId?: string | null; chatId?: string | null; stage?: string | null; error: string },
): Promise<void> {
  if (!this.isLikelyApiUnavailable(params.error, api)) {
    return;
  }
  const cabinetId =
    this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
  const cabinetLabel = await this.cabinets.getCabinetDisplayLabel(cabinetId);
  const dedupKey = `${api}:${cabinetId}:${params.chatId ?? 'n/a'}:${params.stage ?? 'n/a'}`;
  const now = Date.now();
  const prev = this.lastCriticalNotifyAtByKey.get(dedupKey) ?? 0;
  if (now - prev < 60_000) {
    return;
  }
  this.lastCriticalNotifyAtByKey.set(dedupKey, now);
  const text =
    `[CRITICAL API UNAVAILABLE]\n` +
    `cabinetId=${cabinetId}\n` +
    `cabinet=${cabinetLabel}\n` +
    `api=${api}\n` +
    `ingestId=${params.ingestId ?? 'n/a'}\n` +
    `chatId=${params.chatId ?? 'n/a'}\n` +
    `stage=${params.stage ?? 'n/a'}\n` +
    `error=${params.error}`;
  try {
    const res = await fetch(CRITICAL_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      this.logger.warn(
        `critical notify failed: status=${res.status} api=${api} ingestId=${params.ingestId ?? 'n/a'}`,
      );
    }
  } catch (e) {
    this.logger.warn(`critical notify error: ${formatError(e)}`);
  }
}

  private async classifyMessage(
  text: string,
  useAiClassifier: boolean,
  preferredKind?: UserbotFilterKind,
  preferredKindSource?: 'group_filter_pattern' | 'group_filter_example',
  groupName?: string,
  replyToMessageId?: string,
  quotedText?: string,
  chatId?: string,
  ingestId?: string,
): Promise<{ kind: MessageKind; aiRequest?: string; aiResponse?: string }> {
  const replyId = String(replyToMessageId ?? '').trim();
  const forcedKind: MessageKind | undefined =
    preferredKind == null || preferredKind === 'ignore'
      ? undefined
      : (preferredKind === 'close' || preferredKind === 'reentry') && !replyId
        ? undefined
        : preferredKind;
  if (forcedKind) {
    return {
      kind: forcedKind,
      aiRequest: limitTrace(
        JSON.stringify({
          operation: 'classifyMessage',
          source: preferredKindSource ?? 'group_filter_example',
          groupName: groupName ?? null,
          preferredKind: forcedKind,
        }),
      ),
      aiResponse: limitTrace(
        JSON.stringify({
          forcedKind,
          reason:
            preferredKindSource === 'group_filter_pattern'
              ? 'matched by user filter pattern for group'
              : 'matched by user examples for group',
        }),
      ),
    };
  }
  if (!useAiClassifier) {
    return { kind: 'other' };
  }
  let ai: Awaited<ReturnType<TranscriptService['classifyTradingMessage']>>;
  try {
    ai = await this.transcript.classifyTradingMessage(text, {
      replyToMessageId,
      quotedText,
      logContext: {
        chatId,
        source: groupName,
        ingestId,
        stage: 'classify',
      },
    });
  } catch (e) {
    const err = formatError(e);
    this.logger.error(
      `CRITICAL: OpenRouter classify unavailable (ingestId=${ingestId ?? 'n/a'}, chatId=${chatId ?? 'n/a'}): ${err}`,
    );
    await this.appLog.append('error', 'system', 'CRITICAL: OpenRouter classify unavailable', {
      ingestId: ingestId ?? null,
      chatId: chatId ?? null,
      groupName: groupName ?? null,
      error: err,
      stage: 'classify',
    });
    if (ingestId && chatId) {
      await this.notifySignalFailureToBot({
        ingestId,
        chatId,
        token: extractTokenHint(text),
        stage: 'classify',
        error: err,
      });
    }
    await this.notifyCriticalExternalApiUnavailable('openrouter', {
      ingestId: ingestId ?? null,
      chatId: chatId ?? null,
      stage: 'classify',
      error: err,
    });
    throw new Error(`CRITICAL_CLASSIFY:${err}`);
  }
  const aiRequest = limitTrace(
    ai.debug?.request ??
      JSON.stringify({
        operation: 'classifyTradingMessage',
        text,
        replyToMessageId: replyToMessageId ?? null,
        quotedText: quotedText ?? null,
      }),
  );
  const aiResponse = limitTrace(
    JSON.stringify({
      aiKind: ai.kind,
      aiReason: ai.reason,
      usedFallback: ai.debug?.usedFallback ?? false,
      rawResponse: ai.debug?.response,
    }),
  );
  return { kind: ai.kind, aiRequest, aiResponse };
}

  async getBalanceGuardSnapshot(): Promise<{
  minBalanceUsd: number;
  balanceUsd: number | null;
  totalBalanceUsd: number | null;
  paused: boolean;
  reason?: string;
}> {
  const minBalanceUsd = await this.getNumberSetting(
    'TELEGRAM_USERBOT_MIN_BALANCE_USD',
    USERBOT_MIN_BALANCE_USD_DEFAULT,
    0,
  );
  const cabinetCacheKey = this.cabinetContext.getCabinetId() ?? '__global__';
  const now = Date.now();
  let balanceUsd: number | undefined;
  let totalBalanceUsd: number | undefined;
  const cached = this.balanceCheckCacheByCabinet.get(cabinetCacheKey);
  if (
    cached &&
    now - cached.checkedAtMs < USERBOT_BALANCE_CHECK_CACHE_MS &&
    cached.minBalanceUsd === minBalanceUsd
  ) {
    balanceUsd = cached.balanceUsd;
    totalBalanceUsd = cached.totalBalanceUsd;
  } else {
    const details = await this.bybit.getUnifiedUsdtBalanceDetails();
    balanceUsd = details?.availableUsd;
    totalBalanceUsd = details?.totalUsd;
    this.balanceCheckCacheByCabinet.set(cabinetCacheKey, {
      checkedAtMs: now,
      balanceUsd,
      totalBalanceUsd,
      minBalanceUsd,
    });
  }

  const paused =
    balanceUsd !== undefined &&
    Number.isFinite(balanceUsd) &&
    balanceUsd < minBalanceUsd;
  const reason =
    balanceUsd !== undefined &&
    Number.isFinite(balanceUsd) &&
    balanceUsd < minBalanceUsd
      ? `Автоматическая установка ордеров приостановлена: доступный баланс ${balanceUsd.toFixed(2)}$ ниже порога ${minBalanceUsd.toFixed(2)}$`
      : undefined;
  return {
    minBalanceUsd,
    balanceUsd: balanceUsd ?? null,
    totalBalanceUsd: totalBalanceUsd ?? null,
    paused,
    reason,
  };
}


  private async getLowBalanceGuardState(): Promise<{
  ignore: boolean;
  reason?: string;
}> {
  const snapshot = await this.getBalanceGuardSnapshot();
  if (snapshot.paused) {
    return {
      ignore: true,
      reason:
        snapshot.reason ??
        `Доступный баланс USDT ниже порога ${snapshot.minBalanceUsd.toFixed(2)} — сообщение пропущено`,
    };
  }
  return { ignore: false };
}

  private async getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.settings.get(key);
    if (raw == null || raw.trim() === '') {
      return fallback;
    }
    return raw.trim().toLowerCase() === 'true';
  }

  private async getNumberSetting(
    key: string,
    fallback: number,
    min?: number,
    max?: number,
  ): Promise<number> {
    const raw = await this.settings.get(key);
    if (raw == null || raw.trim() === '') {
      return fallback;
    }
    const n = Number(raw.trim());
    if (!Number.isFinite(n)) {
      return fallback;
    }
    if (min != null && n < min) {
      return min;
    }
    if (max != null && n > max) {
      return max;
    }
    return n;
  }
}
