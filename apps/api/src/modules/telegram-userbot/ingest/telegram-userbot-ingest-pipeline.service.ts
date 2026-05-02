import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeTradingPair, type SignalDto } from '@repo/shared';
import { TelegramClient } from 'telegram';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { SettingsService } from '../../settings/settings.service';
import { TranscriptService } from '../../transcript/transcript.service';
import { BybitService } from '../../bybit/bybit.service';
import { OrdersService } from '../../orders/orders.service';
import { TelegramService } from '../../telegram/telegram.service';
import { VkNotifyMirrorService } from '../../vk/vk-notify-mirror.service';
import { UserbotSignalHashService } from '../userbot-signal-hash.service';
import { parseSignalPriceArrayJson } from '../userbot-signal-hash.util';
import {
  CLOSE_REOPEN_COOLDOWN_MS,
  CRITICAL_NOTIFY_URL,
  USERBOT_BALANCE_CHECK_CACHE_MS,
  USERBOT_INLINE_TEXT_MAX_CHARS,
  USERBOT_MIN_BALANCE_USD_DEFAULT,
  USERBOT_SIGNAL_LEVELS_EDIT_WATCH_POLL_MS,
  USERBOT_SIGNAL_LEVELS_EDIT_WATCH_TTL_MS,
} from '../telegram-userbot.constants';
import type {
  ActiveSignalLookup,
  MessageKind,
  ProcessIngestOptions,
  UserbotFilterKind,
} from '../telegram-userbot.types';
import { TelegramUserbotFiltersService } from '../filters/telegram-userbot-filters.service';
import { TelegramUserbotClientService } from '../client/telegram-userbot-client.service';
import { TelegramUserbotIngestService } from './telegram-userbot-ingest.service';
import { TelegramUserbotMirrorService } from '../mirror/telegram-userbot-mirror.service';
import { TelegramUserbotSettingsService } from '../settings/telegram-userbot-settings.service';
import { arePriceArraysClose, isNumberClose } from '../utils/telegram-userbot-text-similarity.util';
import {
  countLockEmojiInText,
  extractTokenHint,
  makeTextPreview,
} from '../utils/telegram-userbot-text.util';
import {
  extractMessageDate,
  extractReplyToMessageId,
  extractSignalExternalId,
  limitTrace,
  readBooleanish,
  readNumber,
  readNumericString,
  readString,
  resolveChatIdFromDialog,
  toChannelChatId,
  toLegacyGroupChatId,
} from '../utils/telegram-userbot-parse.util';

@Injectable()
export class TelegramUserbotIngestPipelineService {
  private readonly logger = new Logger(TelegramUserbotIngestPipelineService.name);
  private readonly pairDirectionTransitions = new Map<string, { count: number; reason?: string }>();
  private readonly pairDirectionCloseCooldownUntilMs = new Map<string, number>();
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
  private readonly signalLevelsValidationWatchTimers = new Map<string, NodeJS.Timeout>();
  private readonly signalLevelsValidationWatchDeadlineMs = new Map<string, number>();
  private readonly signalLevelsValidationWatchInflight = new Set<string>();

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
    private readonly userbotClient: TelegramUserbotClientService,
    private readonly ingest: TelegramUserbotIngestService,
    private readonly userbotSettings: TelegramUserbotSettingsService,
    private readonly userbotFilters: TelegramUserbotFiltersService,
    private readonly userbotMirror: TelegramUserbotMirrorService,
  ) {}

  private async getCurrentUserClient(): Promise<TelegramClient | null> {
    return this.userbotClient.getCurrentUserClient();
  }

  private async isClientAuthorized(client: TelegramClient | null): Promise<boolean> {
    return this.userbotClient.isClientAuthorized(client);
  }

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
      ? await this.fetchChatMessageText(ingest.chatId, replyToMessageId)
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
      const reentry = await this.tryReentryFromReply({
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
      const closeResult = await this.tryCloseSignalFromReply({
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
            const root = await this.resolveRootSignalSourceMessageId(
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
      const resultNotify = await this.tryNotifyResultWithoutEntryFromReply({
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
            const root = await this.resolveRootSignalSourceMessageId(
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
    const transitionWait = await this.waitForPairDirectionTransitionIfAny(
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
    const closeCooldownMs = this.getCloseCooldownRemainingMs(signal.pair, signal.direction);
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
      const activeSignal = await this.findActiveSignalForPairAndDirection(
        signal.pair,
        signal.direction,
      );

      if (activeSignal) {
        const activeSource = await this.resolveSourcePriorityForSignal(activeSignal);
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
            this.scheduleSignalLevelsValidationEditWatch(ingest.id);
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
        this.scheduleSignalLevelsValidationEditWatch(ingest.id);
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

private isManualCloseCancellationText(text: string): boolean {
  const t = text.toLowerCase();
  // \b works only with ASCII; for Cyrillic use Unicode lookahead/lookbehind
  const hasClosedWord =
    /\b(closed|close)\b/.test(t) ||
    /(?<!\p{L})(закрыт|закрыта|закрыто|закрыли|закрываем|отменен|отмена)(?!\p{L})/u.test(t);
  if (!hasClosedWord) {
    return false;
  }
  const hasTpOrSl =
    /\b(tp|take[\s-]?profit|sl|stop[\s-]?loss)\b/.test(t) ||
    /(?<!\p{L})(стоп|тейк)(?!\p{L})/u.test(t) ||
    /стоп-лосс/u.test(t) ||
    /✅|❌|🟢|🔴/.test(text);
  return !hasTpOrSl;
}

private isReentryText(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\b(re[-\s]?entry|reentry|re[\s-]enter)\b/.test(t) ||
    /(?<!\p{L})(перезаход|перезаходим|перезайти)(?!\p{L})/u.test(t) ||
    /повторный вход/u.test(t) ||
    /снова входим/u.test(t)
  );
}

private async tryReentryFromReply(params: {
  chatId: string;
  messageId: string;
  text: string;
  replyToMessageId?: string;
  signalExternalId?: string;
}): Promise<
  { ok: true; mode: 'updated' | 'replaced' } | { ok: false; error: string }
> {
  const replyToMessageId = params.replyToMessageId?.trim() || undefined;
  const signalExternalId = params.signalExternalId?.trim() || undefined;
  if (!replyToMessageId && !signalExternalId) {
    return {
      ok: false,
      error: 'Сообщение о перезаходе без цитаты исходного сигнала и без SIGNAL ID',
    };
  }
  const lookup = await this.findActiveSignalFromReply({
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
  const closeCooldownMs = this.getCloseCooldownRemainingMs(base.pair, base.direction);
  if (closeCooldownMs > 0) {
    return {
      ok: false,
      error: `Перезаход временно заблокирован после close (${Math.ceil(closeCooldownMs / 1000)}s)`,
    };
  }
  this.bybit.suspendStaleReconcile(base.pair, base.direction, 'reentry flow');
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
      this.fetchChatMessageText(params.chatId, rootSource.messageId),
      replyToMessageId && replyToMessageId !== rootSource.messageId
        ? this.fetchChatMessageText(params.chatId, replyToMessageId)
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
      typeof updatePartial.capitalPercent === 'number' &&
      updatePartial.capitalPercent >= 0;
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
      Array.isArray(nextTakeProfits) &&
      !arePriceArraysClose(nextTakeProfits, base.takeProfits);

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
        typeof updatePartial.capitalPercent === 'number' &&
        updatePartial.capitalPercent >= 0
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
    this.bybit.resumeStaleReconcile(base.pair, base.direction);
  }
}

private signalFromDb(prev: {
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

private async tryCloseSignalFromReply(params: {
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
  const lookup = await this.findActiveSignalFromReply({
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
  this.beginPairDirectionTransition(closeSignal.pair, closeSignal.direction, 'close flow');
  try {
    const closed = await this.bybit.closeSignalManually(signal.id);
    if (!closed.ok) {
      return {
        ok: false,
        error: closed.error ?? closed.details ?? 'Не удалось закрыть сделку на Bybit',
      };
    }
    this.setCloseCooldown(closeSignal.pair, closeSignal.direction);
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
    this.endPairDirectionTransition(closeSignal.pair, closeSignal.direction);
  }
}

private async tryNotifyResultWithoutEntryFromReply(params: {
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
  const lookup = await this.findActiveSignalFromReply({
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
  // Дедупликация только повторной обработки того же сообщения в чате (ретраи ingest).
  // Разные сообщения о результате по одному сигналу (TP1, TP2, …) — отдельные messageId → уведомляем снова.
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
  this.beginPairDirectionTransition(closeSignal.pair, closeSignal.direction, 'result stale cancel');
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
    this.setCloseCooldown(closeSignal.pair, closeSignal.direction);
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
    this.endPairDirectionTransition(closeSignal.pair, closeSignal.direction);
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

private async findActiveSignalFromReply(params: {
  chatId: string;
  replyToMessageId?: string;
  signalExternalId?: string;
  flowLabel: 'Close' | 'Reentry' | 'Result';
}): Promise<
  | {
      ok: true;
      signal: ActiveSignalLookup;
      rootSource: {
        messageId: string;
        chain: string[];
        matchedSignalMessageIds: string[];
        stopReason: string;
      };
    }
  | { ok: false; error: string }
> {
  const replyToMessageId = params.replyToMessageId?.trim() || undefined;
  const signalExternalId = params.signalExternalId?.trim() || undefined;
  if (!replyToMessageId && !signalExternalId) {
    return {
      ok: false,
      error: 'Нужна цитата исходного сигнала или SIGNAL ID',
    };
  }
  if (!replyToMessageId && signalExternalId) {
    const signal = await this.findActiveSignalByExternalId(params.chatId, signalExternalId);
    if (signal) {
      return {
        ok: true,
        signal,
        rootSource: {
          messageId: signal.sourceMessageId ?? '',
          chain: [],
          matchedSignalMessageIds: [],
          stopReason: 'resolved_by_signal_external_id',
        },
      };
    }
    return {
      ok: false,
      error: `Для SIGNAL ID ${signalExternalId} активный сигнал не найден`,
    };
  }
  const rootSource = await this.resolveRootSignalSourceMessageId(
    params.chatId,
    replyToMessageId!,
  );
  const signal = await this.prisma.signal.findFirst({
    where: {
      deletedAt: null,
      sourceChatId: params.chatId,
      sourceMessageId: rootSource.messageId,
      status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      pair: true,
      direction: true,
      entries: true,
      stopLoss: true,
      takeProfits: true,
      leverage: true,
      orderUsd: true,
      capitalPercent: true,
      source: true,
      sourceChatId: true,
      sourceMessageId: true,
    },
  });
  if (!signal) {
    if (signalExternalId) {
      const signalByExternalId = await this.findActiveSignalByExternalId(
        params.chatId,
        signalExternalId,
      );
      if (signalByExternalId) {
        return {
          ok: true,
          signal: signalByExternalId,
          rootSource: {
            messageId: signalByExternalId.sourceMessageId ?? rootSource.messageId,
            chain: rootSource.chain,
            matchedSignalMessageIds: rootSource.matchedSignalMessageIds,
            stopReason: `${rootSource.stopReason};fallback_signal_external_id`,
          },
        };
      }
    }
    const lookup = await this.collectSignalLookupDiagnostics(
      params.chatId,
      rootSource.messageId,
      rootSource.chain,
    );
    void this.appLog.append(
      'warn',
      'telegram',
      `${params.flowLabel}: active signal not found for resolved root`,
      {
        sourceChatId: params.chatId,
        quotedMessageId: replyToMessageId,
        signalExternalId: signalExternalId ?? null,
        rootSourceMessageId: rootSource.messageId,
        rootResolution: {
          chain: rootSource.chain,
          matchedSignalMessageIds: rootSource.matchedSignalMessageIds,
          stopReason: rootSource.stopReason,
        },
        lookup,
      },
    );
    return {
      ok: false,
      error: `Для цитаты ${params.chatId}:${replyToMessageId} активный сигнал не найден (root: ${rootSource.messageId})`,
    };
  }
  return { ok: true, signal, rootSource };
}

private async findActiveSignalByExternalId(
  chatId: string,
  signalExternalId: string,
): Promise<ActiveSignalLookup | null> {
  const row = await (this.prisma as any).signal.findFirst({
    where: {
      deletedAt: null,
      sourceChatId: chatId,
      signalExternalId,
      status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      pair: true,
      direction: true,
      entries: true,
      stopLoss: true,
      takeProfits: true,
      leverage: true,
      orderUsd: true,
      capitalPercent: true,
      source: true,
      sourceChatId: true,
      sourceMessageId: true,
      signalExternalId: true,
    },
  });
  return (row ?? null) as ActiveSignalLookup | null;
}

private async resolveRootSignalSourceMessageId(
  chatId: string,
  messageId: string,
): Promise<{
  messageId: string;
  chain: string[];
  matchedSignalMessageIds: string[];
  stopReason: string;
}> {
  const startId = messageId.trim();
  if (!startId) {
    return {
      messageId,
      chain: [],
      matchedSignalMessageIds: [],
      stopReason: 'empty_start_id',
    };
  }

  const visited = new Set<string>();
  const chain: string[] = [];
  const matchedSignalMessageIds: string[] = [];
  let currentId: string | undefined = startId;
  let oldestMatchedId: string | undefined;
  let stopReason = 'chain_end';

  for (let depth = 0; depth < 20 && currentId; depth += 1) {
    if (visited.has(currentId)) {
      stopReason = 'cycle_detected';
      break;
    }
    visited.add(currentId);
    chain.push(currentId);

    const hasSignal = await this.hasAnySignalForSourceMessage(chatId, currentId);
    if (hasSignal) {
      oldestMatchedId = currentId;
      matchedSignalMessageIds.push(currentId);
    }

    const meta = await this.fetchChatMessageMeta(chatId, currentId);
    if (meta.error) {
      stopReason = `fetch_failed:${meta.error}`;
      break;
    }
    const nextId = meta.replyToMessageId?.trim();
    if (!nextId) {
      stopReason = 'chain_end';
      break;
    }
    currentId = nextId;
  }

  if (chain.length >= 20 && currentId) {
    stopReason = 'depth_limit_reached';
  }

  return {
    messageId: oldestMatchedId ?? startId,
    chain,
    matchedSignalMessageIds,
    stopReason,
  };
}

private async hasAnySignalForSourceMessage(
  chatId: string,
  messageId: string,
): Promise<boolean> {
  const count = await this.prisma.signal.count({
    where: {
      sourceChatId: chatId,
      sourceMessageId: messageId,
    },
  });
  return count > 0;
}

private async collectSignalLookupDiagnostics(
  chatId: string,
  rootSourceMessageId: string,
  chain: string[],
): Promise<{
  rootAnyCount: number;
  rootActiveCount: number;
  rootStatuses: string[];
  chainMatches: Array<{ messageId: string; total: number; active: number; statuses: string[] }>;
}> {
  const rootSignals = await this.prisma.signal.findMany({
    where: {
      sourceChatId: chatId,
      sourceMessageId: rootSourceMessageId,
    },
    select: {
      id: true,
      status: true,
      deletedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  const chainUnique = Array.from(new Set(chain)).slice(0, 20);
  const chainRows = await Promise.all(
    chainUnique.map(async (messageId) => {
      const rows = await this.prisma.signal.findMany({
        where: {
          sourceChatId: chatId,
          sourceMessageId: messageId,
        },
        select: {
          status: true,
          deletedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      const active = rows.filter(
        (row) =>
          row.deletedAt == null && ['ORDERS_PLACED', 'OPEN', 'PARSED'].includes(row.status),
      ).length;
      return {
        messageId,
        total: rows.length,
        active,
        statuses: rows.map((row) => row.status),
      };
    }),
  );

  const rootActive = rootSignals.filter(
    (row) =>
      row.deletedAt == null && ['ORDERS_PLACED', 'OPEN', 'PARSED'].includes(row.status),
  ).length;

  return {
    rootAnyCount: rootSignals.length,
    rootActiveCount: rootActive,
    rootStatuses: rootSignals.map((row) => row.status),
    chainMatches: chainRows.filter((row) => row.total > 0),
  };
}

private clearSignalLevelsValidationWatch(ingestId: string): void {
  const t = this.signalLevelsValidationWatchTimers.get(ingestId);
  if (t) {
    clearInterval(t);
    this.signalLevelsValidationWatchTimers.delete(ingestId);
  }
  this.signalLevelsValidationWatchDeadlineMs.delete(ingestId);
}

clearAllSignalLevelsValidationWatches(): void {
  for (const id of this.signalLevelsValidationWatchTimers.keys()) {
    this.clearSignalLevelsValidationWatch(id);
  }
}

/**
 * После ошибки validateSignalLevels: опрос Telegram; при смене текста — полный автоповтор
 * (очередь по каждому кабинету, с обходом подтверждения).
 */
private scheduleSignalLevelsValidationEditWatch(ingestId: string): void {
  this.clearSignalLevelsValidationWatch(ingestId);
  const deadlineMs = Date.now() + USERBOT_SIGNAL_LEVELS_EDIT_WATCH_TTL_MS;
  this.signalLevelsValidationWatchDeadlineMs.set(ingestId, deadlineMs);
  const timer = setInterval(() => {
    void this.tickSignalLevelsValidationEditWatch(ingestId);
  }, USERBOT_SIGNAL_LEVELS_EDIT_WATCH_POLL_MS);
  this.signalLevelsValidationWatchTimers.set(ingestId, timer);
  void this.appLog.append('info', 'telegram', 'Userbot: наблюдение за правкой сообщения после ошибки уровней', {
    ingestId,
    pollMs: USERBOT_SIGNAL_LEVELS_EDIT_WATCH_POLL_MS,
    ttlMs: USERBOT_SIGNAL_LEVELS_EDIT_WATCH_TTL_MS,
  });
}

private async tickSignalLevelsValidationEditWatch(ingestId: string): Promise<void> {
  const deadlineMs = this.signalLevelsValidationWatchDeadlineMs.get(ingestId);
  if (deadlineMs == null) {
    this.clearSignalLevelsValidationWatch(ingestId);
    return;
  }
  if (Date.now() > deadlineMs) {
    this.clearSignalLevelsValidationWatch(ingestId);
    void this.appLog.append('info', 'telegram', 'Userbot: истекло ожидание правки сообщения (уровни)', {
      ingestId,
    });
    return;
  }
  if (this.signalLevelsValidationWatchInflight.has(ingestId)) {
    return;
  }
  this.signalLevelsValidationWatchInflight.add(ingestId);
  try {
    const row = await this.prisma.tgUserbotIngest.findUnique({
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
    if (!row) {
      this.clearSignalLevelsValidationWatch(ingestId);
      return;
    }
    if (row.status === 'placed' || row.status === 'cancelled_by_confirmation') {
      this.clearSignalLevelsValidationWatch(ingestId);
      return;
    }
    const meta = await this.fetchChatMessageMeta(row.chatId, row.messageId);
    if (meta.error) {
      return;
    }
    const fresh = (meta.text ?? '').trim();
    if (!fresh) {
      return;
    }
    const prev = (readString(row.text) ?? '').trim();
    if (fresh === prev) {
      return;
    }

    this.appendIngestStageLog(
      'info',
      'Userbot: текст сообщения в канале изменился (наблюдение уровней)',
      { id: row.id, chatId: row.chatId, messageId: row.messageId },
      { signalHash: row.signalHash, status: row.status },
    );

    const oldHash = row.signalHash?.trim() ?? '';
    if (oldHash) {
      await this.userbotSignalHash.release(oldHash);
    }
    await this.prisma.tgUserbotIngest.update({
      where: { id: ingestId },
      data: { text: fresh, signalHash: null },
    });

    const metaForJob = {
      replyToMessageId: meta.replyToMessageId,
      signalExternalId: extractSignalExternalId(fresh),
    };
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
          status: 'ignored',
        },
        text: fresh.length > USERBOT_INLINE_TEXT_MAX_CHARS ? null : fresh,
        textLen: fresh.length,
        meta: metaForJob,
        options: {
          enforceBalanceGuard: true,
          source: 'poll',
          telegramReceivedAt: new Date(),
          ingestCreatedAt: row.createdAt,
          suppressPlacementFailureExternalNotify: true,
          bypassConfirmationForAutoRetry: true,
        },
        route,
      });
    }
  } catch (e) {
    this.logger.warn(
      `tickSignalLevelsValidationEditWatch ingest=${ingestId}: ${formatError(e)}`,
    );
  } finally {
    this.signalLevelsValidationWatchInflight.delete(ingestId);
  }
}

  async fetchChatMessageMeta(
  chatId: string,
  messageId: string,
): Promise<{ text?: string; replyToMessageId?: string; error?: string }> {
  const client = await this.getCurrentUserClient();
  if (!client || !(await this.isClientAuthorized(client))) {
    return { error: 'telegram_client_unavailable' };
  }
  try {
    const list = (await client.getMessages(chatId, {
      ids: [Number(messageId)],
      limit: 1,
    })) as unknown as Array<Record<string, unknown>>;
    const msg = list[0];
    return {
      text: readString(msg?.message),
      replyToMessageId: extractReplyToMessageId(
        msg?.replyTo ?? msg?.reply_to ?? msg?.replyToMsgId ?? msg?.reply_to_msg_id,
      ),
    };
  } catch (e) {
    const err = formatError(e);
    this.logger.warn(
      `fetchChatMessageMeta failed chat=${chatId} msg=${messageId}: ${err}`,
    );
    return { error: err };
  }
}

private async fetchChatMessageText(
  chatId: string,
  messageId: string,
): Promise<string | undefined> {
  const meta = await this.fetchChatMessageMeta(chatId, messageId);
  return meta.text;
}

private async findActiveSignalForPairAndDirection(
  pair: string,
  direction: 'long' | 'short',
): Promise<ActiveSignalLookup | null> {
  const wantPair = normalizeTradingPair(pair);
  const cabinetId = this.cabinetContext.getCabinetId();
  const rows = await this.prisma.signal.findMany({
    where: {
      ...(cabinetId ? { cabinetId } : {}),
      deletedAt: null,
      status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
      direction,
    },
    select: {
      id: true,
      pair: true,
      direction: true,
      entries: true,
      stopLoss: true,
      takeProfits: true,
      leverage: true,
      orderUsd: true,
      capitalPercent: true,
      source: true,
      sourceChatId: true,
      sourceMessageId: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  return (
    rows.find((row) => normalizeTradingPair(row.pair) === wantPair) ??
    null
  );
}

private async resolveSourcePriorityForSignal(signal: {
  source: string | null;
  sourceChatId: string | null;
}): Promise<{ priority: number; sourceName: string | null }> {
  const sourceName = signal.source?.trim() || null;
  const chatId = signal.sourceChatId?.trim() || null;
  if (!chatId) {
    return { priority: 0, sourceName };
  }
  const chat = await this.userbotSettings.getScopedChatMeta(chatId);
  return {
    priority: this.userbotSettings.normalizeSourcePriority(chat?.sourcePriority),
    sourceName: chat?.title || sourceName || chatId,
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

private pairDirectionKey(pair: string, direction: 'long' | 'short'): string {
  return `${normalizeTradingPair(pair)}:${direction}`;
}

private setCloseCooldown(pair: string, direction: 'long' | 'short'): void {
  const key = this.pairDirectionKey(pair, direction);
  const untilMs = Date.now() + CLOSE_REOPEN_COOLDOWN_MS;
  this.pairDirectionCloseCooldownUntilMs.set(key, untilMs);
  void this.appLog.append('debug', 'telegram', 'Userbot: close cooldown set', {
    pair: normalizeTradingPair(pair),
    direction,
    cooldownMs: CLOSE_REOPEN_COOLDOWN_MS,
    untilIso: new Date(untilMs).toISOString(),
  });
}

private getCloseCooldownRemainingMs(pair: string, direction: 'long' | 'short'): number {
  const key = this.pairDirectionKey(pair, direction);
  const untilMs = this.pairDirectionCloseCooldownUntilMs.get(key);
  if (!untilMs) {
    return 0;
  }
  const remain = untilMs - Date.now();
  if (remain <= 0) {
    this.pairDirectionCloseCooldownUntilMs.delete(key);
    return 0;
  }
  return remain;
}

private beginPairDirectionTransition(
  pair: string,
  direction: 'long' | 'short',
  reason?: string,
): void {
  const key = this.pairDirectionKey(pair, direction);
  const prev = this.pairDirectionTransitions.get(key);
  this.pairDirectionTransitions.set(key, {
    count: (prev?.count ?? 0) + 1,
    reason: reason ?? prev?.reason,
  });
  void this.appLog.append('debug', 'telegram', 'Userbot: pair/direction transition started', {
    pair: normalizeTradingPair(pair),
    direction,
    reason: reason ?? null,
    lockCount: (prev?.count ?? 0) + 1,
  });
}

private endPairDirectionTransition(pair: string, direction: 'long' | 'short'): void {
  const key = this.pairDirectionKey(pair, direction);
  const prev = this.pairDirectionTransitions.get(key);
  if (!prev) {
    return;
  }
  if (prev.count <= 1) {
    this.pairDirectionTransitions.delete(key);
    void this.appLog.append('debug', 'telegram', 'Userbot: pair/direction transition finished', {
      pair: normalizeTradingPair(pair),
      direction,
    });
    return;
  }
  this.pairDirectionTransitions.set(key, {
    count: prev.count - 1,
    reason: prev.reason,
  });
  void this.appLog.append('debug', 'telegram', 'Userbot: pair/direction transition decremented', {
    pair: normalizeTradingPair(pair),
    direction,
    lockCount: prev.count - 1,
  });
}

private async waitForPairDirectionTransitionIfAny(
  pair: string,
  direction: 'long' | 'short',
  timeoutMs = 15_000,
  pollMs = 250,
): Promise<{ waited: boolean; timedOut: boolean; waitedMs: number }> {
  const key = this.pairDirectionKey(pair, direction);
  if (!this.pairDirectionTransitions.has(key)) {
    return { waited: false, timedOut: false, waitedMs: 0 };
  }
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  while (Date.now() <= deadline) {
    if (!this.pairDirectionTransitions.has(key)) {
      return { waited: true, timedOut: false, waitedMs: Date.now() - startedAt };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return { waited: true, timedOut: true, waitedMs: Date.now() - startedAt };
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
  const dedupKey = `${api}:${params.chatId ?? 'n/a'}:${params.stage ?? 'n/a'}`;
  const now = Date.now();
  const prev = this.lastCriticalNotifyAtByKey.get(dedupKey) ?? 0;
  if (now - prev < 60_000) {
    return;
  }
  this.lastCriticalNotifyAtByKey.set(dedupKey, now);
  const text =
    `[CRITICAL API UNAVAILABLE]\n` +
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
