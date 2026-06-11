import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  normalizeTradingPair,
  type ContentKind,
  type SignalDto,
  type TranscriptIncomplete,
  type TranscriptResult,
} from '@repo/shared';

import { BybitService } from '../bybit/bybit.service';
import { resolveForcedLeverageWithChatOverride } from '../settings/forced-leverage.util';
import {
  parseLeverageRangeMode,
  parseOptionalLeverageInt,
  resolveEffectiveLeverage,
} from '../settings/leverage-policy.util';
import { SettingsService } from '../settings/settings.service';
import { SignalParseDto } from './dto/signal-parse.dto';
import { TranscriptOpenRouterBillingService } from './transcript-openrouter-billing.service';
import { TranscriptOpenRouterClientService } from './transcript-openrouter-client.service';
import { TranscriptOpenRouterModelChainService } from './transcript-openrouter-model-chain.service';
import {
  formatOpenRouterError,
  tryParseModelContent,
} from './transcript-openrouter-parse.util';
import type {
  OpenRouterLogContext,
  TranscriptMessage,
  TranscriptMessagePart,
  TranscriptParseOverrides,
} from './transcript.types';
import {
  fieldLabelRu,
  isCompletePartial,
  listMissingRequiredFields,
  type LeverageFieldOptions,
  normalizePartialSignal,
  sanitizeSignalSource,
} from './partial-signal.util';
import {
  buildChannelContentGenerationPrompt,
  buildContentRewritePrompt,
  buildFilterPatternGenerationPrompt,
  buildJsonSchemaRules,
  buildSystemPrompt,
  buildTradingMessageClassifierPrompt,
  normalizeOpenRouterAudioFormat,
} from './transcript-prompt-builders.util';
import {
  isUserbotClassifierKind,
  type UserbotClassifierKind,
  type UserbotFilterKindValue,
} from '../telegram-userbot/utils/userbot-message-kind.util';

@Injectable()
export class TranscriptService {
  private readonly logger = new Logger(TranscriptService.name);

  constructor(
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    private readonly openRouterModelChain: TranscriptOpenRouterModelChainService,
    private readonly openRouterBilling: TranscriptOpenRouterBillingService,
    private readonly openRouterClient: TranscriptOpenRouterClientService,
  ) {}

  async getOpenrouterBalance(): Promise<{
    ok: boolean;
    balanceUsd: number | null;
    totalCreditsUsd: number | null;
    totalUsageUsd: number | null;
    error?: string;
  }> {
    return this.openRouterBilling.getOpenrouterBalance();
  }

  private async resolveDefaultOrderUsdForParse(
    overrides?: TranscriptParseOverrides,
  ): Promise<number> {
    if (
      overrides?.defaultOrderUsd != null &&
      Number.isFinite(overrides.defaultOrderUsd) &&
      overrides.defaultOrderUsd > 0
    ) {
      return overrides.defaultOrderUsd;
    }
    const details = await this.bybit.getUnifiedUsdtBalanceDetails();
    return this.settings.getDefaultOrderUsd(details?.totalUsd);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async backfillOpenrouterGenerationCosts(): Promise<void> {
    return this.openRouterBilling.backfillOpenrouterGenerationCosts();
  }

  async classifyTradingMessage(
    text: string,
    context?: {
      replyToMessageId?: string;
      quotedText?: string;
      logContext?: OpenRouterLogContext;
    },
  ): Promise<{
    kind: UserbotClassifierKind;
    reason?: string;
    debug?: {
      model?: string;
      request: string;
      response: string;
      usedFallback: boolean;
    };
  }> {
    const classifierPrompt = buildTradingMessageClassifierPrompt();
    const replyToMessageId = context?.replyToMessageId?.trim() || undefined;
    const quotedText = context?.quotedText?.trim() || undefined;
    const requestPayload = {
      operation: 'classifyTradingMessage',
      text,
      replyToMessageId: replyToMessageId ?? null,
      quotedText: quotedText ?? null,
      prompt: classifierPrompt,
    };

    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      throw new Error('OpenRouter недоступен: OPENROUTER_API_KEY is missing');
    }
    const model =
      (await this.openRouterModelChain.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT')) ??
      (await this.settings.get('OPENROUTER_MODEL_DEFAULT'));
    if (!model) {
      throw new Error('OpenRouter недоступен: model is missing');
    }

    try {
      const userInput =
        replyToMessageId || quotedText
          ? [
              `MAIN_MESSAGE:\n${text}`,
              `REPLY_TO_MESSAGE_ID: ${replyToMessageId ?? 'none'}`,
              `QUOTED_MESSAGE:\n${quotedText ?? 'none'}`,
            ].join('\n\n')
          : text;
      const messages = [
        { role: 'system', content: classifierPrompt },
        { role: 'user', content: userInput },
      ];
      const content = await this.openRouterClient.callOpenRouter(
        apiKey,
        model,
        messages,
        {
          operation: 'classifyTradingMessage',
          kind: 'text',
          logContext: context?.logContext,
        },
      );
      const responseRaw =
        typeof content === 'string' ? content : JSON.stringify(content);
      const parsed = tryParseModelContent(content);
      if (!parsed.ok) {
        const reason =
          parsed.result.ok === false
            ? parsed.result.error
            : 'Classifier parse returned non-error result';
        throw new Error(`Classifier вернул невалидный JSON: ${reason}`);
      }
      const root = parsed.value as { kind?: string; reason?: string };
      if (isUserbotClassifierKind(root.kind)) {
        return {
          kind: root.kind,
          reason: root.reason,
          debug: {
            model,
            request: JSON.stringify({ ...requestPayload, model, messages }),
            response: responseRaw,
            usedFallback: false,
          },
        };
      }
      throw new Error('Classifier returned unknown kind');
    } catch (e) {
      throw new Error(`OpenRouter classifyTradingMessage failed: ${formatOpenRouterError(e)}`);
    }
  }

  async generateFilterPatterns(params: {
    kind: UserbotFilterKindValue;
    example: string;
  }): Promise<{
    ok: boolean;
    patterns?: string[];
    error?: string;
    debug?: {
      model?: string;
      request: string;
      response: string;
    };
  }> {
    const example = params.example.trim();
    if (example.length < 6) {
      return { ok: false, error: 'Пример слишком короткий для генерации паттернов' };
    }

    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return { ok: false, error: 'OPENROUTER_API_KEY is not configured' };
    }

    const model =
      (await this.openRouterModelChain.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT')) ??
      (await this.settings.get('OPENROUTER_MODEL_DEFAULT'));
    if (!model) {
      return { ok: false, error: 'OPENROUTER model is not configured' };
    }

    const prompt = buildFilterPatternGenerationPrompt(params.kind);

    const userInput = `MESSAGE_KIND: ${params.kind}\n\nEXAMPLE_MESSAGE:\n${example}`;
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: userInput },
    ];
    try {
      const content = await this.openRouterClient.callOpenRouter(apiKey, model, messages, {
        operation: 'generateFilterPatterns',
      });
      const responseRaw =
        typeof content === 'string' ? content : JSON.stringify(content);
      const parsed = tryParseModelContent(content);
      if (!parsed.ok) {
        return {
          ok: false,
          error: parsed.result.ok === false ? parsed.result.error : 'Не удалось разобрать ответ AI',
          debug: {
            model,
            request: JSON.stringify({ model, messages }),
            response: responseRaw,
          },
        };
      }
      const rawPatterns = Array.isArray((parsed.value as { patterns?: unknown[] }).patterns)
        ? ((parsed.value as { patterns?: unknown[] }).patterns ?? [])
        : [];
      const patterns = Array.from(
        new Set(
          rawPatterns
            .map((item) => (typeof item === 'string' ? item.trim().toLowerCase() : ''))
            .filter((item) => item.length >= 2),
        ),
      ).slice(0, 6);
      if (patterns.length === 0) {
        return {
          ok: false,
          error: 'AI не вернул пригодные паттерны',
          debug: {
            model,
            request: JSON.stringify({ model, messages }),
            response: responseRaw,
          },
        };
      }
      return {
        ok: true,
        patterns,
        debug: {
          model,
          request: JSON.stringify({ model, messages }),
          response: responseRaw,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: formatOpenRouterError(e),
        debug: {
          model,
          request: JSON.stringify({ model, messages }),
          response: formatOpenRouterError(e),
        },
      };
    }
  }

  async rewriteContentPost(params: {
    classification: 'analysis' | 'content' | 'news' | 'other';
    text: string;
    instruction?: string;
    openrouterLogContext?: OpenRouterLogContext;
  }): Promise<{
    ok: boolean;
    text?: string;
    error?: string;
    debug?: { model?: string; request?: string; response?: string };
  }> {
    const sourceText = params.text.trim();
    if (sourceText.length < 6) {
      return { ok: false, error: 'Текст слишком короткий для переписывания' };
    }

    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return { ok: false, error: 'OPENROUTER_API_KEY is not configured' };
    }

    const model =
      (await this.openRouterModelChain.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT')) ??
      (await this.settings.get('OPENROUTER_MODEL_DEFAULT'));
    if (!model) {
      return { ok: false, error: 'OPENROUTER model is not configured' };
    }

    const prompt = buildContentRewritePrompt(params.classification);
    const extra = params.instruction?.trim();
    const userInput = [
      `CLASSIFICATION: ${params.classification}`,
      extra ? `EDITOR_INSTRUCTION:\n${extra}` : null,
      `ORIGINAL_TEXT:\n${sourceText}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: userInput },
    ];
    try {
      const content = await this.openRouterClient.callOpenRouter(apiKey, model, messages, {
        operation: 'rewriteContentPost',
        logContext: params.openrouterLogContext,
      });
      const responseRaw =
        typeof content === 'string' ? content : JSON.stringify(content);
      const parsed = tryParseModelContent(content);
      if (!parsed.ok) {
        return {
          ok: false,
          error: parsed.result.ok === false ? parsed.result.error : 'Не удалось разобрать ответ AI',
          debug: {
            model,
            request: JSON.stringify({ model, messages }),
            response: responseRaw,
          },
        };
      }
      const rewritten = String((parsed.value as { text?: unknown }).text ?? '').trim();
      if (rewritten.length < 2) {
        return {
          ok: false,
          error: 'AI вернул пустой текст',
          debug: {
            model,
            request: JSON.stringify({ model, messages }),
            response: responseRaw,
          },
        };
      }
      return {
        ok: true,
        text: rewritten,
        debug: {
          model,
          request: JSON.stringify({ model, messages }),
          response: responseRaw,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: formatOpenRouterError(e),
        debug: {
          model,
          request: JSON.stringify({ model, messages }),
          response: formatOpenRouterError(e),
        },
      };
    }
  }

  async generateChannelContent(params: {
    outputKind: string;
    sources: Array<{ classification: string; text: string }>;
    instruction?: string;
    outputStyle?: string | null;
    openrouterLogContext?: OpenRouterLogContext;
  }): Promise<{
    ok: boolean;
    text?: string;
    error?: string;
    debug?: { model?: string; request?: string; response?: string };
  }> {
    const sources = params.sources
      .map((s) => ({
        classification: String(s.classification ?? '').trim(),
        text: String(s.text ?? '').trim(),
      }))
      .filter((s) => s.text.length >= 6);
    if (sources.length === 0) {
      return { ok: false, error: 'Нет исходных текстов для генерации' };
    }

    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return { ok: false, error: 'OPENROUTER_API_KEY is not configured' };
    }

    const model =
      (await this.openRouterModelChain.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT')) ??
      (await this.settings.get('OPENROUTER_MODEL_DEFAULT'));
    if (!model) {
      return { ok: false, error: 'OPENROUTER model is not configured' };
    }

    const prompt = buildChannelContentGenerationPrompt({
      outputKind: params.outputKind,
      outputStyle: params.outputStyle,
    });
    const extra = params.instruction?.trim();
    const userInput = [
      `OUTPUT_KIND: ${params.outputKind}`,
      extra ? `EDITOR_INSTRUCTION:\n${extra}` : null,
      ...sources.map(
        (s, i) => `SOURCE_${i + 1} (${s.classification}):\n${s.text}`,
      ),
    ]
      .filter(Boolean)
      .join('\n\n');
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: userInput },
    ];
    try {
      const content = await this.openRouterClient.callOpenRouter(apiKey, model, messages, {
        operation: 'generateChannelContent',
        logContext: params.openrouterLogContext,
      });
      const responseRaw =
        typeof content === 'string' ? content : JSON.stringify(content);
      const parsed = tryParseModelContent(content);
      if (!parsed.ok) {
        return {
          ok: false,
          error: parsed.result.ok === false ? parsed.result.error : 'Не удалось разобрать ответ AI',
          debug: {
            model,
            request: JSON.stringify({ model, messages }),
            response: responseRaw,
          },
        };
      }
      const generated = String((parsed.value as { text?: unknown }).text ?? '').trim();
      if (generated.length < 2) {
        return {
          ok: false,
          error: 'AI вернул пустой текст',
          debug: {
            model,
            request: JSON.stringify({ model, messages }),
            response: responseRaw,
          },
        };
      }
      return {
        ok: true,
        text: generated,
        debug: {
          model,
          request: JSON.stringify({ model, messages }),
          response: responseRaw,
        },
      };
    } catch (e) {
      return {
        ok: false,
        error: formatOpenRouterError(e),
        debug: {
          model,
          request: JSON.stringify({ model, messages }),
          response: formatOpenRouterError(e),
        },
      };
    }
  }

  /**
   * Уточнение сигнала по комментарию пользователя (контекст: текущий JSON + правка).
   */
  async applyCorrection(
    current: SignalDto,
    userComment: string,
    overrides?: TranscriptParseOverrides,
  ): Promise<TranscriptResult> {
    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      this.logger.warn('applyCorrection: OPENROUTER_API_KEY is missing');
      return { ok: false, error: 'OPENROUTER_API_KEY is not configured' };
    }

    const model = await this.openRouterModelChain.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT');
    if (!model) {
      this.logger.warn('applyCorrection: OPENROUTER model is missing');
      return {
        ok: false,
        error:
          'OPENROUTER_MODEL_TEXT or OPENROUTER_MODEL_DEFAULT is not configured',
      };
    }

    const defaultOrderUsd: number = await this.resolveDefaultOrderUsdForParse(
      overrides,
    );
    const correctionPrompt = `You are editing a trading signal. The user provides the current signal as JSON and a correction in natural language (possibly Russian).
${buildJsonSchemaRules(defaultOrderUsd)}
Merge the user's correction into the signal. Keep fields unchanged if the user did not ask to change them.`;

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: correctionPrompt },
      {
        role: 'user',
        content: `Current signal JSON:\n${JSON.stringify({ signal: current })}\n\nUser correction / comment:\n${userComment}`,
      },
    ];

    const t0 = Date.now();
    this.logger.log(
      `applyCorrection: model=${model} commentLen=${userComment.length}`,
    );
    try {
      const content = await this.openRouterClient.callOpenRouter(apiKey, model, messages, {
        operation: 'applyCorrection',
      });
      const ms = Date.now() - t0;
      this.logger.log(`applyCorrection: OpenRouter ok in ${ms}ms`);
      const levOpts = await this.getLeverageFieldOptions(overrides);
      const result = await this.finishTranscriptResult(
        await this.parseModelContent(content, levOpts, defaultOrderUsd),
        levOpts,
        defaultOrderUsd,
      );
      return result;
    } catch (e) {
      const ms = Date.now() - t0;
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `applyCorrection: OpenRouter failed after ${ms}ms: ${msg}`,
        e instanceof Error ? e.stack : undefined,
      );
      return { ok: false, error: 'OpenRouter request failed', details: msg };
    }
  }

  /**
   * Следующий ход диалога: частичный сигнал + история сообщений + новый текст.
   */
  async continueSignalDraft(
    partial: Partial<SignalDto>,
    userTurns: string[],
    newMessage: string,
    overrides?: TranscriptParseOverrides,
  ): Promise<TranscriptResult> {
    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      this.logger.warn('continueSignalDraft: OPENROUTER_API_KEY is missing');
      return { ok: false, error: 'OPENROUTER_API_KEY is not configured' };
    }

    const model = await this.openRouterModelChain.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT');
    if (!model) {
      this.logger.warn('continueSignalDraft: OPENROUTER model is missing');
      return {
        ok: false,
        error:
          'OPENROUTER_MODEL_TEXT or OPENROUTER_MODEL_DEFAULT is not configured',
      };
    }

    const historyBlock = userTurns.length
      ? `Previous user messages (in order):\n${userTurns.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n`
      : '';

    const defaultOrderUsd: number = await this.resolveDefaultOrderUsdForParse(
      overrides,
    );
    const userBlock =
      `${historyBlock}Current known partial signal (JSON):\n${JSON.stringify({ signal: partial })}\n\n` +
      `Latest user message:\n${newMessage}\n\n` +
      `Update the signal. If everything required is present, set status to "complete".`;
    const messages: { role: string; content: string }[] = [
      { role: 'system', content: buildSystemPrompt(defaultOrderUsd) },
      {
        role: 'user',
        content: userBlock,
      },
    ];

    const t0 = Date.now();
    this.logger.log(
      `continueSignalDraft: model=${model} turns=${userTurns.length} newLen=${newMessage.length}`,
    );
    try {
      const content = await this.openRouterClient.callOpenRouter(apiKey, model, messages, {
        operation: 'continueSignalDraft',
      });
      const ms = Date.now() - t0;
      this.logger.log(`continueSignalDraft: OpenRouter ok in ${ms}ms`);
      const levOpts = await this.getLeverageFieldOptions(overrides);
      const result = await this.finishTranscriptResult(
        await this.parseModelContent(content, levOpts, defaultOrderUsd),
        levOpts,
        defaultOrderUsd,
      );
      return result;
    } catch (e) {
      const ms = Date.now() - t0;
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(
        `continueSignalDraft: OpenRouter failed after ${ms}ms: ${msg}`,
        e instanceof Error ? e.stack : undefined,
      );
      return { ok: false, error: 'OpenRouter request failed', details: msg };
    }
  }

  async parse(
    kind: ContentKind,
    payload: {
      text?: string;
      imageBase64?: string;
      imageMime?: string;
      audioBase64?: string;
      audioMime?: string;
      reentryContext?: {
        baseSignal: Partial<SignalDto>;
        rootSourceMessageId?: string;
        originalMessageText?: string;
        quotedMessageText?: string;
      };
      /** Продолжение черновика: то же сообщение + новый контент (фото/голос). */
      continuationContext?: {
        partial: Partial<SignalDto>;
        userTurns: string[];
      };
      openrouterLogContext?: OpenRouterLogContext;
    },
    overrides?: TranscriptParseOverrides,
  ): Promise<TranscriptResult> {
    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      this.logger.warn('parse: OPENROUTER_API_KEY is missing');
      return { ok: false, error: 'OPENROUTER_API_KEY is not configured' };
    }

    const modelKey =
      kind === 'text'
        ? 'OPENROUTER_MODEL_TEXT'
        : kind === 'image'
          ? 'OPENROUTER_MODEL_IMAGE'
          : 'OPENROUTER_MODEL_AUDIO';
    const model = await this.openRouterModelChain.resolveModelKeyWithDefault(modelKey);
    if (!model) {
      this.logger.warn(`parse: ${modelKey} and OPENROUTER_MODEL_DEFAULT are missing`);
      return {
        ok: false,
        error: `${modelKey} or OPENROUTER_MODEL_DEFAULT is not configured`,
      };
    }

    const defaultOrderUsd: number = await this.resolveDefaultOrderUsdForParse(
      overrides,
    );
    const messages = this.buildMessages(kind, payload, defaultOrderUsd);
    const t0 = Date.now();
    this.logger.log(
      `parse: kind=${kind} model=${model} (textLen=${payload.text?.length ?? 0})`,
    );
    const modelChain = await this.openRouterModelChain.getModelChainForKind(kind, model);
    const fallbackModels = modelChain.slice(1);

    try {
      const content = await this.openRouterClient.callOpenRouter(apiKey, model, messages, {
        operation: 'parse',
        kind,
        fallbackModels,
        logContext: payload.openrouterLogContext,
      });
      const ms = Date.now() - t0;
      this.logger.log(
        `parse: OpenRouter ok in ${ms}ms (primary=${model}${fallbackModels[0] ? `, fallback=${fallbackModels[0]}` : ''})`,
      );
      const levOpts = await this.getLeverageFieldOptions(overrides);
      const parsed = await this.finishTranscriptResult(
        await this.parseModelContent(content, levOpts, defaultOrderUsd),
        levOpts,
        defaultOrderUsd,
      );
      if (!parsed.ok) {
        this.logger.warn(
          `parse: validation/json failed: ${parsed.error} ${parsed.details ?? ''}`,
        );
      }
      return parsed;
    } catch (e) {
      const ms = Date.now() - t0;
      const msg = formatOpenRouterError(e);
      this.logger.error(
        `parse: OpenRouter failed after ${ms}ms: ${msg}`,
        e instanceof Error ? e.stack : undefined,
      );
      return { ok: false, error: 'OpenRouter request failed', details: msg };
    }
  }

  private buildMessages(
    kind: ContentKind,
    payload: {
      text?: string;
      imageBase64?: string;
      imageMime?: string;
      audioBase64?: string;
      audioMime?: string;
      reentryContext?: {
        baseSignal: Partial<SignalDto>;
        rootSourceMessageId?: string;
        originalMessageText?: string;
        quotedMessageText?: string;
      };
      continuationContext?: {
        partial: Partial<SignalDto>;
        userTurns: string[];
      };
    },
    defaultOrderUsd: number,
  ): TranscriptMessage[] {
    const reentry = payload.reentryContext;
    const hasReentryContext =
      reentry != null && Object.keys(reentry.baseSignal ?? {}).length > 0;
    const cont = payload.continuationContext;
    const hasContinuationContext =
      cont != null &&
      (cont.userTurns.length > 0 || Object.keys(cont.partial).length > 0);
    const contPrefix =
      hasContinuationContext
        ? `Continue previous draft.\nKnown partial signal:\n${JSON.stringify(cont!.partial)}\n\n` +
          `Earlier user messages:\n${cont!.userTurns.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n\n` +
          `Merge new content and keep status "incomplete" until required fields are complete.\n\n`
        : '';

    if (kind === 'text') {
      const text = payload.text ?? '';
      if (hasReentryContext) {
        const userContent = [
          'REENTRY_UPDATE_MODE: true',
          reentry?.rootSourceMessageId
            ? `ROOT_SOURCE_MESSAGE_ID: ${reentry.rootSourceMessageId}`
            : undefined,
          `BASE_SIGNAL_JSON:\n${JSON.stringify(reentry?.baseSignal ?? {})}`,
          `ORIGINAL_SIGNAL_MESSAGE:\n${reentry?.originalMessageText?.trim() || 'none'}`,
          `QUOTED_MESSAGE:\n${reentry?.quotedMessageText?.trim() || 'none'}`,
          `UPDATE_MESSAGE:\n${text}`,
          'Task: merge UPDATE_MESSAGE into BASE_SIGNAL_JSON and return the merged signal JSON.',
        ]
          .filter((part): part is string => Boolean(part))
          .join('\n\n');
        return [
          { role: 'system', content: buildSystemPrompt(defaultOrderUsd) },
          { role: 'user', content: userContent },
        ];
      }
      return [
        { role: 'system', content: buildSystemPrompt(defaultOrderUsd) },
        { role: 'user', content: contPrefix + text },
      ];
    }

    if (kind === 'image') {
      const parts: TranscriptMessagePart[] = [
        {
          type: 'text',
          text:
            contPrefix +
            'Извлеки торговый сигнал с изображения и верни только JSON по схеме.',
        },
      ];
      if (payload.imageBase64 && payload.imageMime) {
        parts.push({
          type: 'image_url',
          imageUrl: {
            url: `data:${payload.imageMime};base64,${payload.imageBase64}`,
          },
        });
      }
      return [
        { role: 'system', content: buildSystemPrompt(defaultOrderUsd) },
        { role: 'user', content: parts },
      ];
    }

    const audioNote =
      payload.audioBase64 && payload.audioMime
        ? `Audio attached (${payload.audioMime}). Transcribe and parse signal as JSON.`
        : 'Parse the voice message content.';
    const audioFormat = normalizeOpenRouterAudioFormat(payload.audioMime);
    if (payload.audioBase64 && audioFormat) {
      const parts: TranscriptMessagePart[] = [
        {
          type: 'text',
          text:
            payload.text && payload.text.trim().length > 0
              ? `${contPrefix}${audioNote}\n${payload.text}`
              : `${contPrefix}${audioNote}`,
        },
        {
          type: 'input_audio',
          inputAudio: {
            data: payload.audioBase64,
            format: audioFormat,
          },
        },
      ];
      return [
        { role: 'system', content: buildSystemPrompt(defaultOrderUsd) },
        { role: 'user', content: parts },
      ];
    }
    const userContent =
      payload.text
        ? `${contPrefix}${audioNote}\n${payload.text}`
        : `${contPrefix}${audioNote}\n[binary audio omitted — ensure text was transcribed upstream]`;
    return [
      { role: 'system', content: buildSystemPrompt(defaultOrderUsd) },
      { role: 'user', content: userContent },
    ];
  }

  /**
   * Размер позиции: явный USDT, иначе (legacy) только % от депозита, иначе номинал из настроек DEFAULT_ORDER_USD.
   * При capitalPercent > 100 всегда режим «только процент» (orderUsd в сигнале 0), иначе ложный
   * orderUsd от LLM (часто 100 из примеров в промпте) перекрывает 200%+.
   * При capitalPercent > 100 номинал на Bybit = equity×(pct/100) без дополнительного ×leverage в формуле (см. placeSignalOrders; база процента — equity счёта, не только «доступно»).
   * Если модель одновременно вернула 1–100% капитала и orderUsd ≈ дефолту из промпта (часто 6 USDT из
   * DEFAULT_ORDER_USD), считаем orderUsd шаблонным и используем процент — иначе фикс из JSON полностью
   * перекрывает % в `placeSignalOrders`.
   */
  private resolveOrderUsd(dto: SignalParseDto, defaultOrderUsd: number): number {
    const capPct = Number(dto.capitalPercent);
    const cap = Number.isFinite(capPct) ? capPct : 0;
    const ouRaw = Number(dto.orderUsd);
    const ou = Number.isFinite(ouRaw) ? ouRaw : 0;
    if (cap > 100) {
      return 0;
    }
    const def = Number(defaultOrderUsd);
    const nearDefault =
      Number.isFinite(def) &&
      def > 0 &&
      ou > 0 &&
      Math.abs(ou - def) <= Math.max(0.01, def * 0.002);
    if (cap > 0 && cap <= 100 && nearDefault) {
      return 0;
    }
    if (ou > 0) {
      return ou;
    }
    if (cap > 0) {
      return 0;
    }
    return defaultOrderUsd;
  }

  /** Настройки плеча из SQLite / env: опциональная подстановка или обязательное поле в сигнале. */
  private async getLeverageFieldOptions(
    overrides?: TranscriptParseOverrides | null,
  ): Promise<LeverageFieldOptions> {
    const overrideDefaultLeverage = overrides?.leverageDefault;
    const defRaw = await this.settings.get('DEFAULT_LEVERAGE');
    const parsed =
      defRaw != null && String(defRaw).trim() !== ''
        ? Number(String(defRaw).trim().replace(',', '.'))
        : NaN;
    let defaultLeverage =
      Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : 1;

    if (
      overrideDefaultLeverage != null &&
      Number.isFinite(overrideDefaultLeverage) &&
      overrideDefaultLeverage >= 1
    ) {
      defaultLeverage = Math.round(overrideDefaultLeverage);
    } else if (!Number.isFinite(parsed) || parsed < 1) {
      this.logger.warn(
        'DEFAULT_LEVERAGE is not set or invalid; fallback leverage 1x will be used',
      );
    }

    const rawForcedGlobal = await this.settings.get('FORCED_LEVERAGE');
    const forcedLeverage = resolveForcedLeverageWithChatOverride(
      overrides?.chatForcedLeverage,
      rawForcedGlobal,
    );
    const rangeModeRaw = await this.settings.get('LEVERAGE_RANGE_MODE');
    const rangeMode =
      overrides?.leverageRangeMode ?? parseLeverageRangeMode(rangeModeRaw);
    const minRaw = await this.settings.get('MIN_ALLOWED_LEVERAGE');
    const maxRaw = await this.settings.get('MAX_ALLOWED_LEVERAGE');
    const minAllowed =
      overrides?.minAllowedLeverage ?? parseOptionalLeverageInt(minRaw);
    const maxAllowed =
      overrides?.maxAllowedLeverage ?? parseOptionalLeverageInt(maxRaw);
    if (
      minAllowed != null &&
      maxAllowed != null &&
      Number.isFinite(minAllowed) &&
      Number.isFinite(maxAllowed) &&
      minAllowed > maxAllowed
    ) {
      this.logger.warn(
        `Leverage limits invalid (min=${minAllowed}, max=${maxAllowed}); limits are ignored`,
      );
    }

    return {
      requireLeverage: false,
      defaultLeverage,
      forcedLeverage,
      leverageRangeMode: rangeMode,
      minAllowedLeverage:
        minAllowed != null &&
        maxAllowed != null &&
        minAllowed > maxAllowed
          ? undefined
          : minAllowed,
      maxAllowedLeverage:
        minAllowed != null &&
        maxAllowed != null &&
        minAllowed > maxAllowed
          ? undefined
          : maxAllowed,
    };
  }

  /**
   * Перед валидацией DTO: если разрешена подстановка и в raw нет валидного плеча — подставить default.
   */
  private applyDefaultLeverageToSignalRaw(
    signalRaw: unknown,
    leverageOpts: LeverageFieldOptions,
  ): unknown {
    if (
      leverageOpts.requireLeverage ||
      signalRaw == null ||
      typeof signalRaw !== 'object' ||
      Array.isArray(signalRaw)
    ) {
      return signalRaw;
    }
    const def = leverageOpts.defaultLeverage;
    const ff = leverageOpts.forcedLeverage;
    if ((def === undefined || def < 1) && (ff == null || ff < 1)) {
      return signalRaw;
    }
    const o = { ...(signalRaw as Record<string, unknown>) };
    const lev = o.leverage;
    const rawLeverage =
      typeof lev === 'number'
        ? lev
        : lev != null
          ? parseFloat(String(lev))
          : NaN;
    const rangeRaw = o.leverageRange;
    let leverageRange: [number, number] | undefined;
    if (Array.isArray(rangeRaw) && rangeRaw.length >= 2) {
      const a = Number(rangeRaw[0]);
      const b = Number(rangeRaw[1]);
      if (Number.isFinite(a) && Number.isFinite(b) && a >= 1 && b >= 1) {
        leverageRange = [a, b];
      }
    }
    const hasExplicitLeverage =
      Number.isFinite(rawLeverage) && rawLeverage >= 1;
    if (hasExplicitLeverage) {
      // Явное плечо в сигнале важнее диапазона.
      leverageRange = undefined;
    }
    const policy = {
      rangeMode: leverageOpts.leverageRangeMode ?? 'mid',
      minAllowed: leverageOpts.minAllowedLeverage,
      maxAllowed: leverageOpts.maxAllowedLeverage,
    } as const;
    const base =
      hasExplicitLeverage
        ? rawLeverage
        : def != null && def >= 1
          ? def
          : 1;
    const effective = resolveEffectiveLeverage({
      baseLeverage: base,
      leverageRange,
      forcedLeverage: ff,
      policy,
    });
    o.leverage = effective;
    if (leverageRange) {
      o.leverageRange = leverageRange;
    } else {
      delete o.leverageRange;
    }
    return o;
  }

  /** Если partial уже полный — завершаем без повторного запроса. */
  private async finishTranscriptResult(
    result: TranscriptResult,
    leverageOpts: LeverageFieldOptions,
    defaultOrderUsd: number,
  ): Promise<TranscriptResult> {
    if (result.ok === 'incomplete' && isCompletePartial(result.partial, leverageOpts)) {
      const full = await this.tryCompleteSignal(result.partial, leverageOpts, defaultOrderUsd);
      if (full.ok === true) {
        return full;
      }
    }
    return result;
  }

  private async tryCompleteSignal(
    signalRaw: unknown,
    leverageOpts: LeverageFieldOptions,
    defaultOrderUsd: number,
  ): Promise<TranscriptResult> {
    const prepared = this.applyDefaultLeverageToSignalRaw(signalRaw, leverageOpts);
    const dto = plainToInstance(SignalParseDto, prepared, {
      enableImplicitConversion: true,
    });
    const errors = validateSync(dto);
    if (errors.length > 0) {
      return {
        ok: false,
        error: 'Validation failed',
        details: errors.map((e) => JSON.stringify(e.constraints)).join('; '),
      };
    }

    const orderUsd = this.resolveOrderUsd(dto, defaultOrderUsd);
    const capNorm = Number(dto.capitalPercent);
    const capitalPercent =
      Number.isFinite(capNorm) && capNorm >= 0 ? capNorm : 0;
    const canonicalEntries = dto.entries ?? [];
    const canonicalEntryIsRange = dto.entryIsRange === true;
    const entryNormalized = this.normalizeEqualBoundRangeEntry({
      entries: canonicalEntries,
      entryIsRange: canonicalEntryIsRange,
    });
    const signal: SignalDto = {
      pair: normalizeTradingPair(dto.pair),
      direction: dto.direction,
      entries: entryNormalized.entries,
      entryIsRange: entryNormalized.entryIsRange,
      stopLoss: dto.stopLoss,
      takeProfits: dto.takeProfits,
      leverage: dto.leverage,
      leverageRange:
        Array.isArray(dto.leverageRange) && dto.leverageRange.length >= 2
          ? [dto.leverageRange[0]!, dto.leverageRange[1]!]
          : undefined,
      orderUsd,
      capitalPercent,
      source: sanitizeSignalSource(dto.source),
    };

    return { ok: true, signal };
  }

  /**
   * Канонизирует "нулевой" диапазон входа A-A в обычный одиночный вход A.
   * Применяется единообразно для новых сигналов и update-режима.
   */
  private normalizeEqualBoundRangeEntry(params: {
    entries: number[];
    entryIsRange: boolean;
  }): { entries: number[]; entryIsRange: boolean } {
    const { entries, entryIsRange } = params;
    if (!entryIsRange || entries.length !== 2) {
      return { entries, entryIsRange };
    }
    const a = entries[0]!;
    const b = entries[1]!;
    if (a !== b) {
      return { entries, entryIsRange };
    }
    return { entries: [a], entryIsRange: false };
  }

  private defaultPromptForMissing(missing: string[]): string {
    if (missing.length === 0) {
      return 'Уточните, пожалуйста, недостающие параметры сигнала одним сообщением.';
    }
    const labels = missing.map((k) => fieldLabelRu(k)).join('; ');
    return `Нужно ещё: ${labels}. Ответьте одним сообщением.`;
  }

  private toIncomplete(
    partial: Partial<SignalDto>,
    leverageOpts: LeverageFieldOptions,
  ): TranscriptIncomplete {
    const missing = listMissingRequiredFields(partial, leverageOpts);
    return {
      ok: 'incomplete',
      partial,
      missing,
      prompt: this.defaultPromptForMissing(missing),
    };
  }

  private async parseModelContent(
    content: unknown,
    leverageOpts: LeverageFieldOptions,
    defaultOrderUsd: number,
  ): Promise<TranscriptResult> {
    const parsed = tryParseModelContent(content);
    if (!parsed.ok) {
      return parsed.result;
    }

    const root = parsed.value as {
      status?: string;
      signal?: unknown;
      missing?: unknown;
      prompt?: unknown;
    };

    if (root.signal === undefined || root.signal === null) {
      return {
        ok: false,
        error: 'JSON missing "signal" field',
        details: JSON.stringify(content),
      };
    }

    // Новый формат со статусом
    if (root.status === 'incomplete') {
      const partial = normalizePartialSignal(root.signal);
      const mergedMissing = listMissingRequiredFields(partial, leverageOpts);
      const prompt =
        mergedMissing.length > 0
          ? this.defaultPromptForMissing(mergedMissing)
          : typeof root.prompt === 'string' && root.prompt.trim().length > 0
            ? root.prompt.trim()
            : this.defaultPromptForMissing(mergedMissing);
      return {
        ok: 'incomplete',
        partial,
        missing: mergedMissing,
        prompt,
      };
    }

    if (root.status === 'complete') {
      const full = await this.tryCompleteSignal(root.signal, leverageOpts, defaultOrderUsd);
      if (full.ok === true) {
        return full;
      }
      const partial = normalizePartialSignal(root.signal);
      return this.toIncomplete(partial, leverageOpts);
    }

    // Legacy / без поля status: сначала полный валидный сигнал, иначе — черновик
    const full = await this.tryCompleteSignal(root.signal, leverageOpts, defaultOrderUsd);
    if (full.ok === true) {
      return full;
    }
    const partial = normalizePartialSignal(root.signal);
    return this.toIncomplete(partial, leverageOpts);
  }

}
