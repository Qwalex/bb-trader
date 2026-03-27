import { Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { OpenRouter } from '@openrouter/sdk';

import {
  normalizeTradingPair,
  type ContentKind,
  type SignalDto,
  type TranscriptIncomplete,
  type TranscriptResult,
} from '@repo/shared';

import { AppLogService } from '../app-log/app-log.service';
import { BybitService } from '../bybit/bybit.service';
import { sanitizeForOpenRouterLog } from '../app-log/log-sanitize';
import { SettingsService } from '../settings/settings.service';
import { SignalParseDto } from './dto/signal-parse.dto';
import {
  fieldLabelRu,
  isCompletePartial,
  listMissingRequiredFields,
  type LeverageFieldOptions,
  normalizePartialSignal,
  sanitizeSignalSource,
} from './partial-signal.util';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_SITE_URL = 'https://signals-bot.local';
const OPENROUTER_APP_TITLE = 'SignalsBot';

const TRANSCRIPT_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['complete', 'incomplete'] },
    signal: {
      type: 'object',
      properties: {
        pair: {
          type: ['string', 'null'],
          description:
            'Trading pair as in the message (any case/separator); null if unknown — normalized server-side',
        },
        direction: { type: ['string', 'null'], enum: ['long', 'short', null] },
        entries: { type: ['array', 'null'], items: { type: 'number' }, minItems: 1 },
        stopLoss: { type: ['number', 'null'] },
        takeProfits: {
          type: ['array', 'null'],
          items: { type: 'number' },
          minItems: 1,
        },
        leverage: { type: ['number', 'null'], minimum: 1 },
        orderUsd: { type: 'number', minimum: 0 },
        capitalPercent: { type: 'number', minimum: 0, maximum: 100 },
        source: { type: ['string', 'null'] },
      },
      required: [
        'pair',
        'direction',
        'entries',
        'stopLoss',
        'takeProfits',
        'leverage',
        'orderUsd',
        'capitalPercent',
        'source',
      ],
      additionalProperties: false,
    },
    missing: {
      type: 'array',
      items: {
        type: 'string',
        enum: ['pair', 'direction', 'entries', 'stopLoss', 'takeProfits', 'leverage'],
      },
    },
    prompt: { type: ['string', 'null'] },
  },
  required: ['status', 'signal', 'missing', 'prompt'],
  additionalProperties: false,
} as const;

const CLASSIFIER_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['signal', 'close', 'reentry', 'result', 'other'] },
    reason: { type: 'string' },
  },
  required: ['kind', 'reason'],
  additionalProperties: false,
} as const;

/** Общая схема ответа модели (с явным статусом); defaultOrderUsd — из настроек DEFAULT_ORDER_USD. */
function buildJsonSchemaRules(defaultOrderUsd: number): string {
  return `
Return ONLY valid JSON (no markdown, no commentary) with this exact shape:
{
  "status": "complete" | "incomplete",
  "signal": {
    "pair": "BTCUSDT" | null,
    "direction": "long" | "short" | null,
    "entries": [number, ...] | null,
    "stopLoss": number | null,
    "takeProfits": [number, ...] | null,
    "leverage": number | null,
    "orderUsd": number,
    "capitalPercent": number,
    "source": "string | null"
  },
  "missing": ["pair", "direction", ...],
  "prompt": "Краткий вопрос пользователю на русском: каких данных не хватает" | null
}
Decision policy:
1. First decide whether the message is a NEW actionable trade setup.
2. If the message is not clearly a fresh setup, do NOT try to complete a signal. Return status="incomplete", keep required signal fields null, set missing=[], and set prompt=null.
3. Use status="incomplete" with a clarifying question ONLY when the message is clearly a fresh setup but exactly 1 or 2 required fields are unknown or ambiguous.
4. If 3 or more required fields are unknown/ambiguous, or the message is a report/update/commentary, do NOT ask a question. Return status="incomplete", missing=[], prompt=null.

Special update mode:
- If the user input contains sections named BASE_SIGNAL_JSON and UPDATE_MESSAGE, this is NOT a fresh setup classification task.
- In that case, treat BASE_SIGNAL_JSON as the authoritative current signal state.
- Extract only explicit changes from UPDATE_MESSAGE and merge them into BASE_SIGNAL_JSON.
- Keep all unchanged fields from BASE_SIGNAL_JSON as-is.
- ORIGINAL_SIGNAL_MESSAGE and QUOTED_MESSAGE are reference context only; do not discard known BASE_SIGNAL_JSON values just because they are absent in UPDATE_MESSAGE.
- Return the merged signal. Ask a clarifying question only if UPDATE_MESSAGE makes a required field ambiguous after merging.

Messages that are NOT a fresh setup unless they also contain a full new setup:
- trade result or performance report
- TP/SL hit report
- profit/loss/PNL/percentage report
- duration/period/statistics
- closed/закрыт/закрыта/закрыто
- recap, commentary, status update, or partial follow-up without enough setup fields

Required fields for a valid fresh setup:
- pair
- direction
- stopLoss
- takeProfits

Field rules:
- pair: symbol as written in the message (e.g. BTCUSDT, ethusdt, ETH/USDT, BTC-USDT); casing and separators do not matter because the system normalizes it later.
- direction must be long or short.
- entries and leverage are optional.
- entries: first price is main entry; following prices are DCA levels.
- If the user gives no entry price, treat it as market entry: set entries to null and do NOT ask for clarification only because entries are missing. The order will be placed at market at the execution stage.
- If the message describes ONE entry zone as a range for the same purpose (e.g. "entry range 1 - 2", "buy zone 1-2", "диапазон входа 1 - 2"), use one entry equal to the midpoint, not two DCA levels.
- Extract prices only from explicit labels (Entry, Stop loss, SL, Targets/TP, etc.). Do not blend, infer, or average numbers from different fields.
- Field labels without actual values (e.g. "Entry:", "SL:", "TP1:" with no number after them) do NOT count as known values.
- takeProfits: one or more take-profit prices; several TPs mean equal split across levels.
- orderUsd: total position notional in USDT (e.g. 10, 50, 100). If the user gives percent of balance instead, set orderUsd to 0 and set capitalPercent to that percent.
- capitalPercent: use only when sizing by balance percent; otherwise 0.
- Default sizing: if size is not specified, set orderUsd to ${defaultOrderUsd} and capitalPercent to 0.
- source: ONLY if the user explicitly names the signal provider (Telegram channel, app, or group), e.g. "Binance Killers", "Crypto Signals". Otherwise set source to null. NEVER use "text", "image", "audio", or any input-format word as source.
`;
}

function buildSystemPrompt(defaultOrderUsd: number): string {
  return `You are a trading signal parser. Extract structured data from the user message.
${buildJsonSchemaRules(defaultOrderUsd)}
`;
}

type TranscriptMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: { url: string } }
  | { type: 'input_audio'; inputAudio: { data: string; format: string } };

type TranscriptMessage = {
  role: 'system' | 'user';
  content: string | TranscriptMessagePart[];
};

function normalizeOpenRouterAudioFormat(
  audioMime: string | undefined,
): string | undefined {
  if (!audioMime) return undefined;
  const mime = audioMime.trim().toLowerCase();
  if (!mime) return undefined;
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/x-wav') return 'wav';
  if (mime.includes('/')) {
    const suffix = mime.split('/')[1]?.trim();
    return suffix || undefined;
  }
  return mime;
}

@Injectable()
export class TranscriptService {
  private readonly logger = new Logger(TranscriptService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly appLog: AppLogService,
    private readonly bybit: BybitService,
  ) {}

  async classifyTradingMessage(
    text: string,
    context?: { replyToMessageId?: string; quotedText?: string },
  ): Promise<{
    kind: 'signal' | 'close' | 'reentry' | 'result' | 'other';
    reason?: string;
    debug?: {
      model?: string;
      request: string;
      response: string;
      usedFallback: boolean;
    };
  }> {
    const classifierPrompt = `You classify trading-related Telegram messages.
The user message may contain:
- MAIN_MESSAGE: current message text
- REPLY_TO_MESSAGE_ID: quoted/replied message id
- QUOTED_MESSAGE: quoted/replied message text
Use all provided parts together.

Return ONLY strict JSON:
{
  "kind": "signal" | "close" | "reentry" | "result" | "other",
  "reason": "short reason in Russian"
}

Classification rules:
1. Return "signal" ONLY for a fresh actionable trade setup with pair, side, stop-loss, and at least one take-profit. Entry is optional: if it is omitted, treat it as market entry at the signal placement stage. If any of the required fields above is missing or ambiguous, do NOT return "signal". Leverage and size are optional.
2. Return "close" when the current message explicitly says close/closed/cancel/закрыт/отмена for a trade and it is not a TP/SL result report. Quoted/replied context strongly indicates "close", but even without a quote explicit close wording should still be classified as "close" rather than "result".
3. Return "reentry" ONLY when the current message is a re-entry / add-entry / update instruction for a previously quoted/replied signal. A quoted/replied context is required.
4. Return "result" for outcome/performance messages about an existing or past trade: TP hit, SL hit, closed trade report, profit/loss, PNL, percentages, duration, period, recap, statistics, performance summary.
5. If the text explicitly says close/closed but does NOT mention TP, take profit, SL, stop loss, target reached, тейк, стоп, or similar hit markers, prefer "close" over "result".
6. If the text contains result markers such as TP/SL outcome markers, target reached markers, profit/loss, PNL, duration/period, or performance summary, return "result".
7. Return "other" for everything else: commentary, chat, partial follow-ups, incomplete ideas, or anything that is not clearly one of the categories above.

Priority:
- explicit manual close wording > close
- quoted re-entry/update > reentry
- fresh full setup > signal
- outcome/performance report > result
- otherwise > other

Be conservative: if unsure, return "other".`;
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
      return {
        kind: this.classifyMessageHeuristic(text),
        reason: 'OPENROUTER_API_KEY is missing, fallback to heuristic',
        debug: {
          request: JSON.stringify(requestPayload),
          response: 'OPENROUTER_API_KEY is missing',
          usedFallback: true,
        },
      };
    }
    const model =
      (await this.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT')) ??
      (await this.settings.get('OPENROUTER_MODEL_DEFAULT'));
    if (!model) {
      return {
        kind: this.classifyMessageHeuristic(text),
        reason: 'OpenRouter model is missing, fallback to heuristic',
        debug: {
          request: JSON.stringify(requestPayload),
          response: 'OPENROUTER model is missing',
          usedFallback: true,
        },
      };
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
      const content = await this.callOpenRouter(
        apiKey,
        model,
        messages,
        { operation: 'classifyTradingMessage', kind: 'text' },
      );
      const responseRaw =
        typeof content === 'string' ? content : JSON.stringify(content);
      const parsed = this.tryParseModelContent(content);
      if (!parsed.ok) {
        const reason =
          parsed.result.ok === false
            ? parsed.result.error
            : 'Classifier parse returned non-error result';
        return {
          kind: this.classifyMessageHeuristic(text),
          reason,
          debug: {
            model,
            request: JSON.stringify({ ...requestPayload, model, messages }),
            response: responseRaw,
            usedFallback: true,
          },
        };
      }
      const root = parsed.value as { kind?: string; reason?: string };
      if (
        root.kind === 'signal' ||
        root.kind === 'close' ||
        root.kind === 'reentry' ||
        root.kind === 'result' ||
        root.kind === 'other'
      ) {
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
      return {
        kind: this.classifyMessageHeuristic(text),
        reason: 'Classifier returned unknown kind',
        debug: {
          model,
          request: JSON.stringify({ ...requestPayload, model, messages }),
          response: responseRaw,
          usedFallback: true,
        },
      };
    } catch (e) {
      return {
        kind: this.classifyMessageHeuristic(text),
        reason: this.formatOpenRouterError(e),
        debug: {
          model,
          request: JSON.stringify(requestPayload),
          response: this.formatOpenRouterError(e),
          usedFallback: true,
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
  ): Promise<TranscriptResult> {
    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      this.logger.warn('applyCorrection: OPENROUTER_API_KEY is missing');
      return { ok: false, error: 'OPENROUTER_API_KEY is not configured' };
    }

    const model = await this.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT');
    if (!model) {
      this.logger.warn('applyCorrection: OPENROUTER model is missing');
      return {
        ok: false,
        error:
          'OPENROUTER_MODEL_TEXT or OPENROUTER_MODEL_DEFAULT is not configured',
      };
    }

    const defaultOrderUsd: number = await this.settings.getDefaultOrderUsd();
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
      const content = await this.callOpenRouter(apiKey, model, messages, {
        operation: 'applyCorrection',
      });
      const ms = Date.now() - t0;
      this.logger.log(`applyCorrection: OpenRouter ok in ${ms}ms`);
      const levOpts = await this.getLeverageFieldOptions();
      const result = this.finishTranscriptResult(
        this.parseModelContent(content, levOpts, defaultOrderUsd),
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
  ): Promise<TranscriptResult> {
    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      this.logger.warn('continueSignalDraft: OPENROUTER_API_KEY is missing');
      return { ok: false, error: 'OPENROUTER_API_KEY is not configured' };
    }

    const model = await this.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT');
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

    const defaultOrderUsd: number = await this.settings.getDefaultOrderUsd();
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
      const content = await this.callOpenRouter(apiKey, model, messages, {
        operation: 'continueSignalDraft',
      });
      const ms = Date.now() - t0;
      this.logger.log(`continueSignalDraft: OpenRouter ok in ${ms}ms`);
      const levOpts = await this.getLeverageFieldOptions();
      const result = this.finishTranscriptResult(
        this.parseModelContent(content, levOpts, defaultOrderUsd),
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
    },
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
    const model = await this.resolveModelKeyWithDefault(modelKey);
    if (!model) {
      this.logger.warn(`parse: ${modelKey} and OPENROUTER_MODEL_DEFAULT are missing`);
      return {
        ok: false,
        error: `${modelKey} or OPENROUTER_MODEL_DEFAULT is not configured`,
      };
    }

    const defaultOrderUsd: number = await this.settings.getDefaultOrderUsd();
    if (
      kind === 'text' &&
      typeof payload.text === 'string' &&
      this.classifyHeuristic(payload.text) === 'result'
    ) {
      return {
        ok: 'incomplete',
        partial: {
          orderUsd: defaultOrderUsd,
          capitalPercent: 0,
        },
        missing: [],
        prompt:
          'Похоже на отчёт по уже закрытой/отработанной сделке, а не на новый сигнал. Новый ордер не создаю.',
      };
    }
    const messages = this.buildMessages(kind, payload, defaultOrderUsd);
    const t0 = Date.now();
    this.logger.log(
      `parse: kind=${kind} model=${model} (textLen=${payload.text?.length ?? 0})`,
    );
    const modelChain = await this.getModelChainForKind(kind, model);
    const fallbackModels = modelChain.slice(1);

    try {
      const content = await this.callOpenRouter(apiKey, model, messages, {
        operation: 'parse',
        kind,
        fallbackModels,
      });
      const ms = Date.now() - t0;
      this.logger.log(
        `parse: OpenRouter ok in ${ms}ms (primary=${model}${fallbackModels[0] ? `, fallback=${fallbackModels[0]}` : ''})`,
      );
      const levOpts = await this.getLeverageFieldOptions();
      const parsed = this.finishTranscriptResult(
        this.parseModelContent(content, levOpts, defaultOrderUsd),
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
      const msg = this.formatOpenRouterError(e);
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

  private async callOpenRouter(
    apiKey: string,
    model: string,
    messages: { role: string; content: unknown }[],
    ctx: { operation: string; kind?: ContentKind; fallbackModels?: string[] },
  ): Promise<unknown> {
    const client = new OpenRouter({
      apiKey,
      httpReferer: OPENROUTER_SITE_URL,
      xTitle: OPENROUTER_APP_TITLE,
      timeoutMs: 180_000,
    });

    const schemaName =
      ctx.operation === 'classifyTradingMessage'
        ? 'transcript_classifier_result'
        : 'transcript_signal_result';
    const schema =
      ctx.operation === 'classifyTradingMessage'
        ? CLASSIFIER_RESPONSE_JSON_SCHEMA
        : TRANSCRIPT_RESPONSE_JSON_SCHEMA;
    const responseFormat = {
      type: 'json_schema' as const,
      jsonSchema: {
        name: schemaName,
        strict: true,
        schema,
      },
    };

    const requestBody = {
      model,
      models:
        ctx.fallbackModels && ctx.fallbackModels.length > 0
          ? [model, ...ctx.fallbackModels]
          : undefined,
      messages: sanitizeForOpenRouterLog(messages) as unknown[],
      responseFormat,
    };
    await this.appLog.append('info', 'openrouter', `→ ${ctx.operation}`, {
      url: OPENROUTER_URL,
      method: 'POST',
      operation: ctx.operation,
      contentKind: ctx.kind,
      /** Тело запроса (как уходит к OpenRouter, без секрета — ключ только в заголовке Authorization, не логируем) */
      requestBody,
    });

    try {
      const res = await client.chat.send({
        httpReferer: OPENROUTER_SITE_URL,
        xTitle: OPENROUTER_APP_TITLE,
        chatGenerationParams: {
          model,
          models:
            ctx.fallbackModels && ctx.fallbackModels.length > 0
              ? [model, ...ctx.fallbackModels]
              : undefined,
          messages: messages as never,
          responseFormat,
          stream: false,
        },
      });

      const rawContent = res.choices?.[0]?.message?.content;
      const responsePreview =
        typeof rawContent === 'string'
          ? rawContent.length > 24_000
            ? `${rawContent.slice(0, 24_000)}... [truncated ${rawContent.length - 24_000} chars]`
            : rawContent
          : JSON.stringify(rawContent).slice(0, 24_000);

      await this.appLog.append('info', 'openrouter', `← ${ctx.operation}`, {
        operation: ctx.operation,
        httpStatus: 200,
        /** Текст ответа ассистента (модель) */
        assistantContent: responsePreview,
        /** Метаданные ответа OpenRouter (без дублирования полного текста) */
        responseMeta: {
          id: res.id,
          model: res.model,
          usage: res.usage,
          choicesCount: res.choices?.length ?? 0,
        },
      });

      if (rawContent == null) {
        throw new Error('Empty response from OpenRouter');
      }
      return rawContent;
    } catch (e) {
      const errObj = e as {
        status?: number;
        statusCode?: number;
        error?: unknown;
        cause?: unknown;
        body?: string;
      };
      await this.appLog.append(
        'error',
        'openrouter',
        `✗ ${ctx.operation} failed`,
        {
          operation: ctx.operation,
          error: this.formatOpenRouterError(e),
          status: errObj.status ?? errObj.statusCode,
          responseBody: sanitizeForOpenRouterLog(
            errObj.error ?? errObj.cause ?? errObj.body,
          ),
        },
      );
      throw e;
    }
  }

  /**
   * Размер позиции: явный USDT, иначе (legacy) только % от депозита, иначе номинал из настроек DEFAULT_ORDER_USD.
   */
  private resolveOrderUsd(dto: SignalParseDto, defaultOrderUsd: number): number {
    if (dto.orderUsd != null && dto.orderUsd > 0) {
      return dto.orderUsd;
    }
    if ((dto.capitalPercent ?? 0) > 0) {
      return 0;
    }
    return defaultOrderUsd;
  }

  /** Настройки плеча из SQLite / env: опциональная подстановка или обязательное поле в сигнале. */
  private async getLeverageFieldOptions(): Promise<LeverageFieldOptions> {
    const defRaw = await this.settings.get('DEFAULT_LEVERAGE');
    const parsed =
      defRaw != null && String(defRaw).trim() !== ''
        ? Number(String(defRaw).trim().replace(',', '.'))
        : NaN;
    const defaultLeverage =
      Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : 1;

    if (!Number.isFinite(parsed) || parsed < 1) {
      this.logger.warn(
        'DEFAULT_LEVERAGE is not set or invalid; fallback leverage 1x will be used',
      );
    }

    return {
      requireLeverage: false,
      defaultLeverage,
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
    if (def === undefined || def < 1) {
      return signalRaw;
    }
    const o = { ...(signalRaw as Record<string, unknown>) };
    const lev = o.leverage;
    const n =
      typeof lev === 'number'
        ? lev
        : lev != null
          ? parseFloat(String(lev))
          : NaN;
    if (!Number.isFinite(n) || n < 1) {
      o.leverage = def;
    }
    return o;
  }

  /** Если partial уже полный — завершаем без повторного запроса. */
  private finishTranscriptResult(
    result: TranscriptResult,
    leverageOpts: LeverageFieldOptions,
    defaultOrderUsd: number,
  ): TranscriptResult {
    if (result.ok === 'incomplete' && isCompletePartial(result.partial, leverageOpts)) {
      const full = this.tryCompleteSignal(result.partial, leverageOpts, defaultOrderUsd);
      if (full.ok === true) {
        return full;
      }
    }
    return result;
  }

  private tryCompleteSignal(
    signalRaw: unknown,
    leverageOpts: LeverageFieldOptions,
    defaultOrderUsd: number,
  ): TranscriptResult {
    const prepared = this.applyDefaultLeverageToSignalRaw(signalRaw, leverageOpts);
    const dto = plainToInstance(SignalParseDto, prepared);
    const errors = validateSync(dto);
    if (errors.length > 0) {
      return {
        ok: false,
        error: 'Validation failed',
        details: errors.map((e) => JSON.stringify(e.constraints)).join('; '),
      };
    }

    const orderUsd = this.resolveOrderUsd(dto, defaultOrderUsd);
    const signal: SignalDto = {
      pair: normalizeTradingPair(dto.pair),
      direction: dto.direction,
      entries: dto.entries ?? [],
      stopLoss: dto.stopLoss,
      takeProfits: dto.takeProfits,
      leverage: dto.leverage,
      orderUsd,
      capitalPercent: dto.capitalPercent ?? 0,
      source: sanitizeSignalSource(dto.source),
    };

    return { ok: true, signal };
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

  private parseModelContent(
    content: unknown,
    leverageOpts: LeverageFieldOptions,
    defaultOrderUsd: number,
  ): TranscriptResult {
    const parsed = this.tryParseModelContent(content);
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
      const full = this.tryCompleteSignal(root.signal, leverageOpts, defaultOrderUsd);
      if (full.ok === true) {
        return full;
      }
      const partial = normalizePartialSignal(root.signal);
      return this.toIncomplete(partial, leverageOpts);
    }

    // Legacy / без поля status: сначала полный валидный сигнал, иначе — черновик
    const full = this.tryCompleteSignal(root.signal, leverageOpts, defaultOrderUsd);
    if (full.ok === true) {
      return full;
    }
    const partial = normalizePartialSignal(root.signal);
    return this.toIncomplete(partial, leverageOpts);
  }

  private tryParseModelContent(
    content: unknown,
  ): { ok: true; value: unknown } | { ok: false; result: TranscriptResult } {
    if (content != null && typeof content === 'object' && !Array.isArray(content)) {
      return { ok: true, value: content };
    }

    if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (!part || typeof part !== 'object') return '';
          const p = part as Record<string, unknown>;
          return typeof p.text === 'string' ? p.text : '';
        })
        .join('\n')
        .trim();
      if (text.length === 0) {
        return { ok: false, result: { ok: false, error: 'Model returned empty array content' } };
      }
      return this.tryParseModelContent(text);
    }

    if (typeof content !== 'string') {
      return {
        ok: false,
        result: {
          ok: false,
          error: 'Model returned unsupported content type',
          details: String(content),
        },
      };
    }

    const jsonStr = this.extractJson(content);
    try {
      const json = JSON.parse(jsonStr) as unknown;
      return { ok: true, value: json };
    } catch {
      return {
        ok: false,
        result: { ok: false, error: 'Model did not return valid JSON', details: content },
      };
    }
  }

  private extractJson(content: string): string {
    const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence?.[1]) {
      return fence[1].trim();
    }
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return content.slice(start, end + 1);
    }
    return content.trim();
  }

  private async getModelChainForKind(
    kind: ContentKind,
    primaryModel: string,
  ): Promise<string[]> {
    const chain: string[] = [primaryModel];
    const fallbackKey =
      kind === 'image'
        ? 'OPENROUTER_MODEL_IMAGE_FALLBACK_1'
        : kind === 'audio'
          ? 'OPENROUTER_MODEL_AUDIO_FALLBACK_1'
          : 'OPENROUTER_MODEL_TEXT_FALLBACK_1';
    const fallbackModel = this.normalizeModelName(await this.settings.get(fallbackKey));
    if (fallbackModel) {
      chain.push(fallbackModel);
    }
    const deduped: string[] = [];
    for (const m of chain) {
      if (!deduped.includes(m)) {
        deduped.push(m);
      }
    }
    return deduped;
  }

  private normalizeModelName(value: string | undefined): string | undefined {
    if (!value) return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async resolveModelKeyWithDefault(
    modelKey: string,
  ): Promise<string | undefined> {
    const specific = this.normalizeModelName(await this.settings.get(modelKey));
    if (specific) {
      return specific;
    }
    return this.normalizeModelName(await this.settings.get('OPENROUTER_MODEL_DEFAULT'));
  }

  private formatOpenRouterError(error: unknown): string {
    if (error == null) {
      return 'Unknown OpenRouter error';
    }
    if (error instanceof Error) {
      const body = (error as { body?: unknown }).body;
      if (typeof body === 'string' && body.trim().length > 0) {
        const trimmed = body.trim();
        return `${error.message} | body: ${trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}...` : trimmed}`;
      }
      return error.message;
    }
    return String(error);
  }

  private classifyHeuristic(text: string): 'signal' | 'result' | 'other' {
    const t = text.toLowerCase();
    const hasPairHint =
      /[a-z0-9]{2,20}\s*\/\s*usdt\b/i.test(text) ||
      /\b[a-z0-9]{2,20}usdt\b/i.test(text);
    const hasDirectionHint =
      /\b(long|short)\b/.test(t) || /(лонг|шорт)/u.test(t);
    const hasStopHint =
      /\b(sl|stop[\s-]?loss)\b/.test(t) || /(стоп|стоп-лосс)/u.test(t);
    const hasTpHint =
      /\b(tp|take[\s-]?profit|target|targets)\b/.test(t) ||
      /(тейк|тейк-профит|цели|цель)/u.test(t);
    if (hasPairHint && hasDirectionHint && hasStopHint && hasTpHint) {
      return 'signal';
    }
    const hasResultKeywords =
      /\b(result|profit|pnl|closed|tp hit|sl hit|duration|period)\b/.test(t) ||
      /(результат|прибыль|убыток|закрыт|закрыта|закрыто)/u.test(t);
    const hasPercent = /[-+]?\d+(?:[.,]\d+)?\s*%/u.test(t);
    const hasResultPattern =
      /profit\s*:|pnl\s*:|tp\s*\d+\s*✅|duration\s*:|period\s*:/u.test(t) ||
      /✅\s*$/.test(t);
    if (hasResultKeywords || (hasPercent && hasResultPattern)) {
      return 'result';
    }
    return 'other';
  }

  private classifyMessageHeuristic(
    text: string,
  ): 'signal' | 'close' | 'reentry' | 'result' | 'other' {
    const t = text.toLowerCase();
    const hasCloseWord =
      /\b(close|closed|cancel(?:led)?|force close)\b/u.test(t) ||
      /(?<!\p{L})(закрыт|закрыта|закрыто|закрыли|закрываем|отмена|отменен|отмена)(?!\p{L})/u.test(
        t,
      );
    const hasTpOrSl =
      /\b(tp|take[\s-]?profit|sl|stop[\s-]?loss|target(?:\s+\d+)?\s+reached)\b/u.test(t) ||
      /(?<!\p{L})(тейк|стоп|цель|цели)(?!\p{L})/u.test(t) ||
      /✅|❌|🟢|🔴/.test(text);
    if (hasCloseWord && !hasTpOrSl) {
      return 'close';
    }
    if (
      /\b(re[-\s]?entry|reentry|re[\s-]enter)\b/u.test(t) ||
      /(?<!\p{L})(перезаход|перезаходим|перезайти)(?!\p{L})/u.test(t)
    ) {
      return 'reentry';
    }
    return this.classifyHeuristic(text);
  }
}
