import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
import { BybitService } from '../bybit/bybit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { resolveForcedLeverageWithChatOverride } from '../settings/forced-leverage.util';
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

/** Опциональные дефолты для разбора (userbot: по чату). */
export type TranscriptParseOverrides = {
  defaultOrderUsd?: number;
  leverageDefault?: number;
  /** Принудительное плечо из карточки TgUserbotChat (выше глобального FORCED_LEVERAGE) */
  chatForcedLeverage?: number;
};

type OpenRouterLogContext = {
  chatId?: string;
  source?: string;
  ingestId?: string;
  stage?: string;
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_GENERATION_URL = 'https://openrouter.ai/api/v1/generation';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';
const OPENROUTER_SITE_URL = 'https://signals-bot.local';
const OPENROUTER_APP_TITLE = 'SignalsBot';
const OPENROUTER_MAX_RETRIES = 5;
const OPENROUTER_RETRY_DELAY_MS = 1_000;
const OPENROUTER_GENERATION_LOOKUP_MAX_ATTEMPTS = 8;
const OPENROUTER_GENERATION_LOOKUP_DELAY_MS = 1_500;
const OPENROUTER_GENERATION_WORKER_BATCH = 50;

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
            'USDT linear perp symbol BASEUSDT (e.g. BTCUSDT). If the message names only the base (BTC), output BTCUSDT. Null if unknown — separators/case normalized server-side',
        },
        direction: { type: ['string', 'null'], enum: ['long', 'short', null] },
        entries: { type: ['array', 'null'], items: { type: 'number' }, minItems: 1 },
        entryIsRange: {
          type: ['boolean', 'null'],
          description:
            'true: entries are ONE zone [low, high] (range/zone wording); false: entries are DCA list; null if single entry or market',
        },
        stopLoss: { type: ['number', 'null'] },
        takeProfits: {
          type: ['array', 'null'],
          items: { type: 'number' },
          minItems: 1,
        },
        leverage: { type: ['number', 'null'], minimum: 1 },
        orderUsd: { type: 'number', minimum: 0 },
        capitalPercent: { type: 'number', minimum: 0, maximum: 1000000 },
        source: { type: ['string', 'null'] },
      },
      required: [
        'pair',
        'direction',
        'entries',
        'entryIsRange',
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

const FILTER_PATTERN_GENERATION_JSON_SCHEMA = {
  type: 'object',
  properties: {
    patterns: {
      type: 'array',
      items: { type: 'string', minLength: 2 },
      minItems: 1,
    },
  },
  required: ['patterns'],
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
    "entryIsRange": boolean | null,
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
- pair: always the USDT linear perpetual symbol as BASEUSDT (e.g. BTCUSDT, ETHUSDT, 1000PEPEUSDT). If the message names only the base asset without a quote (BTC, ETH, SOL, PEPE), append USDT. Forms like ETH/USDT, BTC-USDT, ethusdt are fine; casing and separators are normalized server-side.
- direction must be long or short.
- entries and leverage are optional.
- entries / entryIsRange — classify yourself from the text:
  - Range (one entry band): if the text says opening should happen **within** a range/zone/band of values (English: open in a range, enter between A and B, in the zone; Russian: открытие в диапазоне, в зоне, вход в коридоре, между X и Y как границами одной зоны), that is always entryIsRange=true: entries=[lower, higher] ascending. Same for one interval with two bounds for a single "where to enter" idea (zone/диапазон/зона/коридор, or one "A – B" line as min/max of one band). Server uses range-entry rules; no midpoint; not DCA.
  - List / enumeration (DCA): several separate entry prices (numbered list, multiple bullets, "Entry 1/2", distinct steps) without one band framing min/max of one zone. If prices are **only** listed separated by commas (or similar separators) with **no** dash/hyphen/en-dash between two prices as a single band and **no** wording about range/zone/band/диапазон/зона/коридор, treat as DCA: entryIsRange=false or omit, entries in message order. Server uses DCA rules.
  - If unclear: use range only when both numbers are clearly lower and upper bound of one zone; otherwise treat as DCA list.
- If the user gives no entry price, treat it as market entry: set entries to null and do NOT ask for clarification only because entries are missing. The order will be placed at market at the execution stage.
- If the message gives BOTH a market entry option and a limit entry (labels such as Entry market / Entry limit, маркет и лимит, market vs limit, two entry lines where one is market and the other has a price), ALWAYS prefer the limit: set entries to the limit price(s) only. Do NOT set entries to null because "market" is also mentioned alongside an explicit limit price.
- takeProfits: use only target/TP/цели/закрыть по prices — never put TP prices into entries.
- If leverage is given as a range (e.g. "2 - 5"), use the midpoint and round up (2-5 => 4).
- Extract prices only from explicit labels (Entry, Stop loss, SL, Targets/TP, etc.). Do not blend, infer, or average numbers from different fields.
- Field labels without actual values (e.g. "Entry:", "SL:", "TP1:" with no number after them) do NOT count as known values.
- takeProfits: one or more take-profit prices; several TPs mean equal split across levels.
- orderUsd: total position notional in USDT (e.g. 10, 50, 100). If the user gives percent of balance instead, set orderUsd to 0 and set capitalPercent to that percent. If capitalPercent is above 100, orderUsd MUST be 0 — never output a positive orderUsd together with capitalPercent > 100 (no "100" placeholder).
- capitalPercent: percent for sizing when orderUsd is 0. If 1–100: margin share of available balance; notional = margin × leverage. If above 100 (e.g. 500): notional = balance × (capitalPercent/100); leverage applies on exchange only (e.g. 500 with balance 10 → 50 USDT notional). Otherwise 0.
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
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
  ) {}

  async getOpenrouterBalance(): Promise<{
    ok: boolean;
    balanceUsd: number | null;
    totalCreditsUsd: number | null;
    totalUsageUsd: number | null;
    error?: string;
  }> {
    const apiKey = (await this.settings.get('OPENROUTER_API_KEY'))?.trim();
    if (!apiKey) {
      return {
        ok: false,
        balanceUsd: null,
        totalCreditsUsd: null,
        totalUsageUsd: null,
        error: 'OPENROUTER_API_KEY is not configured',
      };
    }
    const parseNum = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    try {
      const res = await fetch(OPENROUTER_CREDITS_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': OPENROUTER_SITE_URL,
          'X-Title': OPENROUTER_APP_TITLE,
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
      }
      const json = (await res.json()) as {
        data?: {
          total_credits?: unknown;
          total_usage?: unknown;
        };
      };
      const totalCreditsUsd = parseNum(json?.data?.total_credits);
      const totalUsageUsd = parseNum(json?.data?.total_usage);
      const balanceUsd =
        totalCreditsUsd != null && totalUsageUsd != null
          ? Number((totalCreditsUsd - totalUsageUsd).toFixed(8))
          : null;
      return {
        ok: true,
        balanceUsd,
        totalCreditsUsd,
        totalUsageUsd,
      };
    } catch (e) {
      return {
        ok: false,
        balanceUsd: null,
        totalCreditsUsd: null,
        totalUsageUsd: null,
        error: this.formatOpenRouterError(e),
      };
    }
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

  private parseNumberOrNull(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'string') {
      const n = Number(value.trim());
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }

  private async fetchGenerationCostUsd(
    apiKey: string,
    generationId: string | undefined,
    meta?: { operation?: string; logContext?: OpenRouterLogContext },
    options?: { maxAttempts?: number; delayMs?: number },
  ): Promise<number | null> {
    const id = String(generationId ?? '').trim();
    if (!id) return null;
    const maxAttempts = Math.max(1, options?.maxAttempts ?? OPENROUTER_GENERATION_LOOKUP_MAX_ATTEMPTS);
    const delayMs = Math.max(0, options?.delayMs ?? OPENROUTER_GENERATION_LOOKUP_DELAY_MS);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch(
          `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(id)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        );
        if (!res.ok) {
          const shouldRetry =
            (res.status === 404 || res.status === 429 || res.status >= 500) &&
            attempt < maxAttempts;
          if (!shouldRetry) {
            await this.appLog.append('error', 'openrouter', '↔ generation lookup failed', {
              operation: meta?.operation,
              generationId: id,
              attempt,
              maxAttempts,
              httpStatus: res.status,
              statusText: res.statusText,
              logContext: meta?.logContext,
            });
          }
          if (shouldRetry) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayMs * attempt),
            );
            continue;
          }
          return null;
        }
        const json = (await res.json()) as {
          data?: { total_cost?: unknown; usage?: unknown; cost?: unknown };
        };
        const data = json.data ?? {};
        const cost =
          this.parseNumberOrNull(data.total_cost) ??
          this.parseNumberOrNull(data.cost) ??
          this.parseNumberOrNull(data.usage);
        if (cost != null) {
          await this.appLog.append('info', 'openrouter', '↔ generation lookup completed', {
            operation: meta?.operation,
            generationId: id,
            attempt,
            maxAttempts,
            httpStatus: res.status,
            resolvedCostUsd: cost,
            logContext: meta?.logContext,
          });
        }
        return cost != null && cost >= 0 ? cost : null;
      } catch (e) {
        const shouldRetry = attempt < maxAttempts;
        if (!shouldRetry) {
          await this.appLog.append('error', 'openrouter', '↔ generation lookup exception', {
            operation: meta?.operation,
            generationId: id,
            attempt,
            maxAttempts,
            error: this.formatOpenRouterError(e),
            logContext: meta?.logContext,
          });
        }
        if (shouldRetry) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayMs * attempt),
          );
          continue;
        }
        return null;
      }
    }
    return null;
  }

  private async upsertGenerationCostEntry(params: {
    generationId: string;
    operation?: string;
    logContext?: OpenRouterLogContext;
    costUsd?: number | null;
    status?: 'pending' | 'resolved' | 'failed';
    attemptsDelta?: number;
    nextRetryAt?: Date | null;
    lastError?: string | null;
  }): Promise<void> {
    const id = params.generationId.trim();
    if (!id) return;
    const existing = await this.prisma.openrouterGenerationCost.findUnique({
      where: { generationId: id },
      select: { attempts: true },
    });
    const nextAttempts =
      (existing?.attempts ?? 0) + Math.max(0, params.attemptsDelta ?? 0);
    await this.prisma.openrouterGenerationCost.upsert({
      where: { generationId: id },
      create: {
        generationId: id,
        operation: params.operation ?? null,
        chatId: params.logContext?.chatId ?? null,
        source: params.logContext?.source ?? null,
        ingestId: params.logContext?.ingestId ?? null,
        costUsd: params.costUsd ?? null,
        status: params.status ?? (params.costUsd != null ? 'resolved' : 'pending'),
        attempts: nextAttempts,
        nextRetryAt: params.nextRetryAt ?? null,
        lastError: params.lastError ?? null,
      },
      update: {
        operation: params.operation ?? undefined,
        chatId: params.logContext?.chatId ?? undefined,
        source: params.logContext?.source ?? undefined,
        ingestId: params.logContext?.ingestId ?? undefined,
        costUsd: params.costUsd ?? undefined,
        status: params.status ?? undefined,
        attempts: nextAttempts,
        nextRetryAt: params.nextRetryAt ?? undefined,
        lastError: params.lastError ?? undefined,
      },
    });
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async backfillOpenrouterGenerationCosts(): Promise<void> {
    const apiKey = (await this.settings.get('OPENROUTER_API_KEY'))?.trim();
    if (!apiKey) return;
    const now = new Date();
    const pending = await this.prisma.openrouterGenerationCost.findMany({
      where: {
        status: 'pending',
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: OPENROUTER_GENERATION_WORKER_BATCH,
    });
    for (const row of pending) {
      const generationId = String(row.generationId ?? '').trim();
      if (!generationId) {
        continue;
      }
      const cost = await this.fetchGenerationCostUsd(
        apiKey,
        generationId,
        {
          operation: typeof row.operation === 'string' ? row.operation : undefined,
          logContext: {
            chatId: typeof row.chatId === 'string' ? row.chatId : undefined,
            source: typeof row.source === 'string' ? row.source : undefined,
            ingestId: typeof row.ingestId === 'string' ? row.ingestId : undefined,
            stage: 'generation-worker',
          },
        },
        { maxAttempts: 1, delayMs: 0 },
      );
      if (cost != null) {
        await this.upsertGenerationCostEntry({
          generationId,
          costUsd: cost,
          status: 'resolved',
          attemptsDelta: 1,
          nextRetryAt: null,
          lastError: null,
        });
        continue;
      }
      const attempts = Number(row.attempts ?? 0) + 1;
      const delay = Math.min(60 * 60_000, 15_000 * 2 ** Math.min(attempts, 8));
      await this.upsertGenerationCostEntry({
        generationId,
        status: attempts >= 30 ? 'failed' : 'pending',
        attemptsDelta: 1,
        nextRetryAt: attempts >= 30 ? null : new Date(Date.now() + delay),
        lastError: 'generation_cost_unavailable',
      });
    }
  }

  async classifyTradingMessage(
    text: string,
    context?: {
      replyToMessageId?: string;
      quotedText?: string;
      logContext?: OpenRouterLogContext;
    },
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
1. Return "signal" ONLY for a fresh actionable trade setup with pair, side, stop-loss, and at least one take-profit. Entry is optional: if it is omitted, treat it as market entry at the signal placement stage. If BOTH market and limit entry are described, treat as limit entry (the limit price counts as the setup). If any of the required fields above is missing or ambiguous, do NOT return "signal". Leverage and size are optional.
1.1. Distinguish labels "SIGNAL" and "SIGNAL ID": a plain "SIGNAL" label is a weak hint of a new setup; "SIGNAL ID" usually references an existing setup and can be close/reentry/result. Do NOT classify as "signal" by "SIGNAL ID" label alone.
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
      throw new Error('OpenRouter недоступен: OPENROUTER_API_KEY is missing');
    }
    const model =
      (await this.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT')) ??
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
      const content = await this.callOpenRouter(
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
      const parsed = this.tryParseModelContent(content);
      if (!parsed.ok) {
        const reason =
          parsed.result.ok === false
            ? parsed.result.error
            : 'Classifier parse returned non-error result';
        throw new Error(`Classifier вернул невалидный JSON: ${reason}`);
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
      throw new Error('Classifier returned unknown kind');
    } catch (e) {
      throw new Error(`OpenRouter classifyTradingMessage failed: ${this.formatOpenRouterError(e)}`);
    }
  }

  async generateFilterPatterns(params: {
    kind: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
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
      (await this.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT')) ??
      (await this.settings.get('OPENROUTER_MODEL_DEFAULT'));
    if (!model) {
      return { ok: false, error: 'OPENROUTER model is not configured' };
    }

    const prompt = `You generate literal substring patterns for Telegram message pre-filters.

Return ONLY strict JSON:
{
  "patterns": ["string", ...]
}

Task:
- Message kind: ${params.kind}
- Generate 3 to 6 short candidate patterns from the example message.
- Every pattern MUST be a literal substring that already exists in the example message, after lowercasing.
- Prefer stable phrases that are specific enough for this kind.
- Avoid overly generic tokens such as coin tickers, usdt, numbers, isolated punctuation, or single common words.
- Do NOT generate regex.
- Do NOT invent text that is absent from the example.
- Keep patterns short, usually 2-40 characters.
- Order patterns from best to weaker alternatives.
- Ensure all patterns are unique.`;

    const userInput = `MESSAGE_KIND: ${params.kind}\n\nEXAMPLE_MESSAGE:\n${example}`;
    const messages = [
      { role: 'system', content: prompt },
      { role: 'user', content: userInput },
    ];
    try {
      const content = await this.callOpenRouter(apiKey, model, messages, {
        operation: 'generateFilterPatterns',
      });
      const responseRaw =
        typeof content === 'string' ? content : JSON.stringify(content);
      const parsed = this.tryParseModelContent(content);
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
        error: this.formatOpenRouterError(e),
        debug: {
          model,
          request: JSON.stringify({ model, messages }),
          response: this.formatOpenRouterError(e),
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

    const model = await this.resolveModelKeyWithDefault('OPENROUTER_MODEL_TEXT');
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
      const content = await this.callOpenRouter(apiKey, model, messages, {
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
      const content = await this.callOpenRouter(apiKey, model, messages, {
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
    const model = await this.resolveModelKeyWithDefault(modelKey);
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
    const modelChain = await this.getModelChainForKind(kind, model);
    const fallbackModels = modelChain.slice(1);

    try {
      const content = await this.callOpenRouter(apiKey, model, messages, {
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
    ctx: {
      operation: string;
      kind?: ContentKind;
      fallbackModels?: string[];
      logContext?: OpenRouterLogContext;
    },
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
        : ctx.operation === 'generateFilterPatterns'
          ? 'transcript_filter_pattern_generation_result'
          : 'transcript_signal_result';
    const schema =
      ctx.operation === 'classifyTradingMessage'
        ? CLASSIFIER_RESPONSE_JSON_SCHEMA
        : ctx.operation === 'generateFilterPatterns'
          ? FILTER_PATTERN_GENERATION_JSON_SCHEMA
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
      logContext: ctx.logContext,
    });

    try {
      let res: unknown;
      let lastError: unknown;
      for (let attempt = 1; attempt <= OPENROUTER_MAX_RETRIES; attempt += 1) {
        try {
          res = await client.chat.send({
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
          break;
        } catch (attemptError) {
          lastError = attemptError;
          const errText = this.formatOpenRouterError(attemptError);
          this.logger.warn(
            `OpenRouter ${ctx.operation} attempt ${attempt}/${OPENROUTER_MAX_RETRIES} failed: ${errText}`,
          );
          if (attempt < OPENROUTER_MAX_RETRIES) {
            await new Promise((resolve) =>
              setTimeout(resolve, OPENROUTER_RETRY_DELAY_MS),
            );
          }
        }
      }
      if (res == null) {
        throw (
          lastError ??
          new Error(
            `OpenRouter request failed after ${OPENROUTER_MAX_RETRIES} attempts`,
          )
        );
      }
      const typedRes = res as {
        id?: string;
        model?: string;
        usage?: unknown;
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const usageRecord =
        typedRes.usage && typeof typedRes.usage === 'object' && !Array.isArray(typedRes.usage)
          ? (typedRes.usage as Record<string, unknown>)
          : undefined;
      const generationId = String(typedRes.id ?? '').trim();
      if (generationId) {
        await this.upsertGenerationCostEntry({
          generationId,
          operation: ctx.operation,
          logContext: ctx.logContext,
          status: 'pending',
          attemptsDelta: 0,
          nextRetryAt: new Date(),
        });
      }
      const resolvedCostUsd = null;

      const rawContent = typedRes.choices?.[0]?.message?.content;
      const responseContent =
        typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

      await this.appLog.append('info', 'openrouter', `← ${ctx.operation}`, {
        operation: ctx.operation,
        httpStatus: 200,
        /** Полный текст ответа ассистента (без обрезки) */
        assistantContent: responseContent,
        /** Полный объект ответа OpenRouter после sanitize (без секретов) */
        openrouterResponse: sanitizeForOpenRouterLog(res),
        /** Метаданные ответа OpenRouter (без дублирования полного текста) */
        responseMeta: {
          id: typedRes.id,
          model: typedRes.model,
          usage: usageRecord,
          costUsd: resolvedCostUsd ?? undefined,
          costSource: undefined,
          generationCostUsd: undefined,
          choicesCount: typedRes.choices?.length ?? 0,
        },
        logContext: ctx.logContext,
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
          retries: OPENROUTER_MAX_RETRIES,
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
   * При capitalPercent > 100 всегда режим «только процент» (orderUsd в сигнале 0), иначе ложный
   * orderUsd от LLM (часто 100 из примеров в промпте) перекрывает 200%+.
   */
  private resolveOrderUsd(dto: SignalParseDto, defaultOrderUsd: number): number {
    const capPct = Number(dto.capitalPercent);
    const cap = Number.isFinite(capPct) ? capPct : 0;
    const ouRaw = Number(dto.orderUsd);
    const ou = Number.isFinite(ouRaw) ? ouRaw : 0;
    if (cap > 100) {
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

    return {
      requireLeverage: false,
      defaultLeverage,
      forcedLeverage,
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
    if (def != null && def >= 1) {
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
    }
    if (ff != null && ff >= 1) {
      o.leverage = ff;
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
    const signal: SignalDto = {
      pair: normalizeTradingPair(dto.pair),
      direction: dto.direction,
      entries: dto.entries ?? [],
      entryIsRange: dto.entryIsRange === true,
      stopLoss: dto.stopLoss,
      takeProfits: dto.takeProfits,
      leverage: dto.leverage,
      orderUsd,
      capitalPercent,
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

  private async parseModelContent(
    content: unknown,
    leverageOpts: LeverageFieldOptions,
    defaultOrderUsd: number,
  ): Promise<TranscriptResult> {
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

}
