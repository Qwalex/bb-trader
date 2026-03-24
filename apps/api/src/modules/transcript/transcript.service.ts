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
import { sanitizeForOpenRouterLog } from '../app-log/log-sanitize';
import { SettingsService } from '../settings/settings.service';
import { SignalParseDto } from './dto/signal-parse.dto';
import {
  fieldLabelRu,
  isCompletePartial,
  listMissingRequiredFields,
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
          description: 'Trading pair, e.g. BTCUSDT; null if unknown',
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
    kind: { type: 'string', enum: ['signal', 'result', 'other'] },
    reason: { type: 'string' },
  },
  required: ['kind', 'reason'],
  additionalProperties: false,
} as const;

/** Общая схема ответа модели (с явным статусом). */
const JSON_SCHEMA_RULES = `
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
Rules:
- If you have ALL required fields with reasonable values, set status to "complete" and fill signal fully.
- If ANY required field is unknown or ambiguous, set status to "incomplete", put known values in signal and put null for unknown fields, list missing field keys in "missing", and ask ONE clear question in Russian in "prompt".
- pair must be uppercase like BTCUSDT, ETHUSDT.
- direction must be long or short.
- entries: first price is main entry, following are DCA levels.
- takeProfits: one or more take-profit prices; several TPs mean equal split of position size at each level (e.g. 4 TPs → 25% each).
- leverage: integer >= 1.
- orderUsd: total position notional in USDT (e.g. 10, 50, 100). If user gives percent of balance instead, set orderUsd to 0 and set capitalPercent (1-100).
- capitalPercent: only when sizing by balance percent; otherwise 0.
- Default sizing: if user does not specify size, set orderUsd to 10 and capitalPercent to 0.
- source: ONLY if the user text explicitly names the signal provider (Telegram channel, app, group), e.g. "Binance Killers", "Crypto Signals". If unknown, set source to null. NEVER set source to "text", "image", "audio", or any word describing input format — those are not signal sources.
`;

const SYSTEM_PROMPT = `You are a trading signal parser. Extract structured data from the user message.
${JSON_SCHEMA_RULES}
`;

type TranscriptMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; imageUrl: { url: string } }
  | { type: 'input_audio'; inputAudio: { data: string; format: string } };

type TranscriptMessage = {
  role: 'system' | 'user';
  content: string | TranscriptMessagePart[];
};

@Injectable()
export class TranscriptService {
  private readonly logger = new Logger(TranscriptService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly appLog: AppLogService,
  ) {}

  async classifyTradingMessage(text: string): Promise<{
    kind: 'signal' | 'result' | 'other';
    reason?: string;
    debug?: {
      model?: string;
      request: string;
      response: string;
      usedFallback: boolean;
    };
  }> {
    const classifierPrompt = `You classify trading-related Telegram messages.
Return ONLY strict JSON:
{
  "kind": "signal" | "result" | "other",
  "reason": "short reason in Russian"
}
Rules:
- signal: ONLY if the message contains ALL required fields for order placement:
  1) pair/token (e.g. BTCUSDT),
  2) side (long/short),
  3) entry price/zone,
  4) stop-loss,
  5) at least one take-profit.
- If ANY required field is missing or ambiguous, do NOT return "signal" (return "other" unless it is clearly a result).
- Leverage and position size/order amount are optional and are NOT required for "signal".
- result: reports past outcome/performance/closed trade/TP/SL hit without actionable new setup.
- If message contains profit/loss info with percentages (e.g. "+12%", "Profit: 22.3%", "-5%"), treat it as "result" unless there is a full new setup with all required fields above.
- other: anything else.
Be conservative: if unsure, return "other".`;
    const requestPayload = {
      operation: 'classifyTradingMessage',
      text,
      prompt: classifierPrompt,
    };

    const apiKey = await this.settings.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return {
        kind: this.classifyHeuristic(text),
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
        kind: this.classifyHeuristic(text),
        reason: 'OpenRouter model is missing, fallback to heuristic',
        debug: {
          request: JSON.stringify(requestPayload),
          response: 'OPENROUTER model is missing',
          usedFallback: true,
        },
      };
    }

    try {
      const messages = [
        { role: 'system', content: classifierPrompt },
        { role: 'user', content: text },
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
          kind: this.classifyHeuristic(text),
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
      if (root.kind === 'signal' || root.kind === 'result' || root.kind === 'other') {
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
        kind: this.classifyHeuristic(text),
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
        kind: this.classifyHeuristic(text),
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

    const correctionPrompt = `You are editing a trading signal. The user provides the current signal as JSON and a correction in natural language (possibly Russian).
${JSON_SCHEMA_RULES}
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
      return this.finishTranscriptResult(this.parseModelContent(content));
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

    const messages: { role: string; content: string }[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `${historyBlock}Current known partial signal (JSON):\n${JSON.stringify({ signal: partial })}\n\n` +
          `Latest user message:\n${newMessage}\n\n` +
          `Update the signal. If everything required is present, set status to "complete".`,
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
      return this.finishTranscriptResult(this.parseModelContent(content));
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

    const messages = this.buildMessages(kind, payload);
    const t0 = Date.now();
    this.logger.log(
      `parse: kind=${kind} model=${model} (textLen=${payload.text?.length ?? 0})`,
    );
    const modelChain = await this.getModelChainForKind(kind, model);
    let lastError: unknown;

    for (let mi = 0; mi < modelChain.length; mi++) {
      const candidateModel = modelChain[mi]!;
      const attempts = candidateModel === model ? 1 : 2;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const content = await this.callOpenRouter(
            apiKey,
            candidateModel,
            messages,
            {
              operation:
                candidateModel === model ? 'parse' : `parse-fallback-${mi + 1}`,
              kind,
            },
          );
          const ms = Date.now() - t0;
          this.logger.log(`parse: OpenRouter ok in ${ms}ms (model=${candidateModel})`);
          const parsed = this.finishTranscriptResult(this.parseModelContent(content));
          if (!parsed.ok) {
            this.logger.warn(
              `parse: validation/json failed: ${parsed.error} ${parsed.details ?? ''}`,
            );
          }
          return parsed;
        } catch (e) {
          lastError = e;
          if (attempt < attempts && this.isRateLimitError(e)) {
            const waitMs = 1200 * attempt;
            this.logger.warn(
              `parse: model=${candidateModel} rate-limited, retry in ${waitMs}ms (attempt ${attempt + 1}/${attempts})`,
            );
            await this.sleep(waitMs);
            continue;
          }
          break;
        }
      }

      if (mi < modelChain.length - 1 && this.shouldRetryWithFallback(lastError)) {
        this.logger.warn(
          `parse: model failed (${candidateModel}), switching to fallback=${modelChain[mi + 1]}`,
        );
        continue;
      }
      break;
    }

    const ms = Date.now() - t0;
    const msg = this.formatOpenRouterError(lastError);
    this.logger.error(
      `parse: OpenRouter failed after ${ms}ms: ${msg}`,
      lastError instanceof Error ? lastError.stack : undefined,
    );
    return { ok: false, error: 'OpenRouter request failed', details: msg };
  }

  private buildMessages(
    kind: ContentKind,
    payload: {
      text?: string;
      imageBase64?: string;
      imageMime?: string;
      audioBase64?: string;
      audioMime?: string;
      continuationContext?: {
        partial: Partial<SignalDto>;
        userTurns: string[];
      };
    },
  ): TranscriptMessage[] {
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
      return [
        { role: 'system', content: SYSTEM_PROMPT },
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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: parts },
      ];
    }

    const audioNote =
      payload.audioBase64 && payload.audioMime
        ? `Audio attached (${payload.audioMime}). Transcribe and parse signal as JSON.`
        : 'Parse the voice message content.';
    const userContent =
      payload.text
        ? `${contPrefix}${audioNote}\n${payload.text}`
        : `${contPrefix}${audioNote}\n[binary audio omitted — ensure text was transcribed upstream]`;
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ];
  }

  private async callOpenRouter(
    apiKey: string,
    model: string,
    messages: { role: string; content: unknown }[],
    ctx: { operation: string; kind?: ContentKind },
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
          messages: messages as never,
          responseFormat,
          provider: { requireParameters: true },
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
   * Размер позиции: явный USDT, иначе (legacy) только % от депозита, иначе 10 USDT по умолчанию.
   */
  private resolveOrderUsd(dto: SignalParseDto): number {
    if (dto.orderUsd != null && dto.orderUsd > 0) {
      return dto.orderUsd;
    }
    if ((dto.capitalPercent ?? 0) > 0) {
      return 0;
    }
    return 10;
  }

  /** Если partial уже полный — завершаем без повторного запроса. */
  private finishTranscriptResult(result: TranscriptResult): TranscriptResult {
    if (result.ok === 'incomplete' && isCompletePartial(result.partial)) {
      const full = this.tryCompleteSignal(result.partial);
      if (full.ok === true) {
        return full;
      }
    }
    return result;
  }

  private tryCompleteSignal(signalRaw: unknown): TranscriptResult {
    const dto = plainToInstance(SignalParseDto, signalRaw);
    const errors = validateSync(dto);
    if (errors.length > 0) {
      return {
        ok: false,
        error: 'Validation failed',
        details: errors.map((e) => JSON.stringify(e.constraints)).join('; '),
      };
    }

    const orderUsd = this.resolveOrderUsd(dto);
    const signal: SignalDto = {
      pair: normalizeTradingPair(dto.pair),
      direction: dto.direction,
      entries: dto.entries,
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

  private toIncomplete(partial: Partial<SignalDto>): TranscriptIncomplete {
    const missing = listMissingRequiredFields(partial);
    return {
      ok: 'incomplete',
      partial,
      missing,
      prompt: this.defaultPromptForMissing(missing),
    };
  }

  private parseModelContent(content: unknown): TranscriptResult {
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
      const mergedMissing = Array.isArray(root.missing)
        ? root.missing.map(String)
        : listMissingRequiredFields(partial);
      const prompt =
        typeof root.prompt === 'string' && root.prompt.trim().length > 0
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
      const full = this.tryCompleteSignal(root.signal);
      if (full.ok === true) {
        return full;
      }
      const partial = normalizePartialSignal(root.signal);
      return this.toIncomplete(partial);
    }

    // Legacy / без поля status: сначала полный валидный сигнал, иначе — черновик
    const full = this.tryCompleteSignal(root.signal);
    if (full.ok === true) {
      return full;
    }
    const partial = normalizePartialSignal(root.signal);
    return this.toIncomplete(partial);
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
    const fallbackKeys =
      kind === 'image'
        ? ['OPENROUTER_MODEL_IMAGE_FALLBACK_1', 'OPENROUTER_MODEL_IMAGE_FALLBACK_2']
        : kind === 'audio'
          ? ['OPENROUTER_MODEL_AUDIO_FALLBACK_1', 'OPENROUTER_MODEL_AUDIO_FALLBACK_2']
          : ['OPENROUTER_MODEL_TEXT_FALLBACK_1', 'OPENROUTER_MODEL_TEXT_FALLBACK_2'];
    for (const key of fallbackKeys) {
      const value = await this.settings.get(key);
      const model = this.normalizeModelName(value);
      if (model) {
        chain.push(model);
      }
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

  private isRateLimitError(error: unknown): boolean {
    const statusCode = (error as { status?: number; statusCode?: number } | null)
      ?.status ??
      (error as { status?: number; statusCode?: number } | null)?.statusCode;
    if (statusCode === 429) {
      return true;
    }
    const msg = this.formatOpenRouterError(error).toLowerCase();
    return msg.includes('rate-limit') || msg.includes('too many requests');
  }

  private shouldRetryWithFallback(error: unknown): boolean {
    const msg = this.formatOpenRouterError(error).toLowerCase();
    const statusCode = (error as { status?: number; statusCode?: number } | null)
      ?.status ??
      (error as { status?: number; statusCode?: number } | null)?.statusCode;
    return (
      statusCode === 404 ||
      msg.includes('no endpoints found') ||
      msg.includes('provider returned error') ||
      msg.includes('does not support') ||
      msg.includes('unsupported') ||
      msg.includes('invalid request') ||
      msg.includes('unprocessable')
    );
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

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), ms);
    });
  }

  private classifyHeuristic(text: string): 'signal' | 'result' | 'other' {
    const t = text.toLowerCase();
    const signalish =
      /\b(entry|entries|вход|входы|sl|stop loss|tp|take profit|long|short|leverage|плечо)\b/.test(
        t,
      ) && /\b(usdt|usd|btc|eth|xrp|sol)\b/.test(t);
    if (signalish) {
      return 'signal';
    }
    if (/\b(result|результат|прибыль|убыток|закрыт|tp hit|sl hit|closed)\b/.test(t)) {
      return 'result';
    }
    return 'other';
  }
}
