import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeTradingPair, type SignalDto } from '@repo/shared';
import { NewMessage } from 'telegram/events';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as QRCode from 'qrcode';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { SettingsService } from '../settings/settings.service';
import {
  parseSourceTpSlStepMap,
  parseSourceTpSlStepRangeMap,
  parseTpSlStepStart,
  type SourceTpSlStepMap,
  type SourceTpSlStepRangeMap,
  type TpSlStepStartMode,
} from '../settings/tp-sl-step.util';
/** До Bybit/Orders/Telegram: иначе orders → telegram раньше transcript. */
import {
  TranscriptService,
  type TranscriptParseOverrides,
} from '../transcript/transcript.service';
import { BybitService } from '../bybit/bybit.service';
import { OrdersService } from '../orders/orders.service';
import { TelegramService } from '../telegram/telegram.service';
import { VkNotifyMirrorService } from '../vk/vk-notify-mirror.service';
import { UserbotSignalHashService } from './userbot-signal-hash.service';
import { parseSignalPriceArrayJson } from './userbot-signal-hash.util';

type MessageKind = 'signal' | 'close' | 'reentry' | 'result' | 'other';
type UserbotFilterKind = 'signal' | 'close' | 'result' | 'reentry';
type UserbotFilterExampleMatch = {
  kind: UserbotFilterKind;
  score: number;
  examplePreview: string;
  requiresQuote: boolean;
};
type UserbotFilterPatternMatch = {
  kind: UserbotFilterKind;
  pattern: string;
  requiresQuote: boolean;
};
type QrPhase =
  | 'idle'
  | 'starting'
  | 'waiting_scan'
  | 'authorized'
  | 'cancelled'
  | 'error';

type QrState = {
  phase: QrPhase;
  loginUrl?: string;
  qrDataUrl?: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
};

type ProcessIngestOptions = {
  enforceBalanceGuard?: boolean;
  source?: 'realtime' | 'poll' | 'manual-reread' | 'manual-reread-all';
  telegramReceivedAt?: Date;
  ingestCreatedAt?: Date;
  enqueuedAtMs?: number;
};

type IngestProcessJob = {
  ingest: {
    id: string;
    chatId: string;
    messageId: string;
    signalHash: string | null;
    status: string;
  };
  /**
   * Текст сообщения может быть большим. Чтобы очередь не раздувала память,
   * храним текст inline только до лимита; иначе подтягиваем из БД по ingest.id.
   */
  text: string | null;
  textLen: number;
  meta?: { replyToMessageId?: string; signalExternalId?: string };
  options?: ProcessIngestOptions;
};

type ActiveSignalLookup = {
  id: string;
  pair: string;
  direction: string;
  entries: string;
  stopLoss: number;
  takeProfits: string;
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
  source: string | null;
  sourceChatId: string | null;
  sourceMessageId: string | null;
  signalExternalId?: string | null;
};

type SourceMartingaleMap = Record<string, number>;
type OpenrouterSpendPeriod = 'day' | '3d' | 'week' | 'month' | 'year';

const USERBOT_POLL_INTERVAL_MS = 2000;
const USERBOT_POLL_FETCH_LIMIT = 20;
const USERBOT_PROCESSING_CONCURRENCY = 4;
const USERBOT_MAX_QUEUE_DEFAULT = 300;
const USERBOT_INLINE_TEXT_MAX_CHARS = 4_000;
const USERBOT_MAX_MESSAGE_AGE_MINUTES_DEFAULT = 10;
const USERBOT_MIN_BALANCE_USD_DEFAULT = 3;
const USERBOT_BALANCE_CHECK_CACHE_MS = 30_000;
const USERBOT_FILTER_MATCH_THRESHOLD = 0.34;
const CLOSE_REOPEN_COOLDOWN_MS = 30_000;
const CRITICAL_NOTIFY_URL = 'https://dev.qwalex.ru/notify/';
const OPENROUTER_BALANCE_LOW_THRESHOLD_USD = 2;
const OPENROUTER_BALANCE_NOTIFY_COOLDOWN_MS = 30 * 60_000;

@Injectable()
export class TelegramUserbotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramUserbotService.name);
  private readonly pairDirectionTransitions = new Map<string, { count: number; reason?: string }>();
  private readonly pairDirectionCloseCooldownUntilMs = new Map<string, number>();
  private readonly lastSeenMessageIds = new Map<string, number>();
  private readonly processingQueue: IngestProcessJob[] = [];
  private readonly processingQueuedIds = new Set<string>();
  private processingWorkersActive = 0;

  private client: TelegramClient | null = null;
  private messageHandlerRegistered = false;
  private enabledChatIds = new Set<string>();

  private qrClient: TelegramClient | null = null;
  private qrTask: Promise<void> | null = null;
  private qrState: QrState = { phase: 'idle' };
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInFlight = false;
  private balanceCheckCache:
    | {
        checkedAtMs: number;
        balanceUsd: number | undefined;
        totalBalanceUsd: number | undefined;
        minBalanceUsd: number;
      }
    | undefined;
  private messageRecencyCache:
    | {
        checkedAtMs: number;
        maxAgeMs: number;
      }
    | undefined;
  private lastCriticalNotifyAtByKey = new Map<string, number>();
  private readonly sourceTpMapSkipLogged = new Set<string>();
  private static readonly SOURCE_MAP_SKIP_LOG_CAP = 400;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly transcript: TranscriptService,
    private readonly bybit: BybitService,
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly telegramBot: TelegramService,
    @Inject(forwardRef(() => VkNotifyMirrorService))
    private readonly vkNotifyMirror: VkNotifyMirrorService,
    private readonly userbotSignalHash: UserbotSignalHashService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshEnabledChatsCache();
    void this.startPollingLoop();
    const enabled = await this.getBoolSetting('TELEGRAM_USERBOT_ENABLED', false);
    if (!enabled) {
      return;
    }
    try {
      await this.connectFromStoredSession();
    } catch (e) {
      const msg = formatError(e);
      this.logger.warn(`Userbot auto-connect skipped: ${msg}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopPollingLoop();
    await this.disconnect();
    await this.stopQrClient();
  }

  async getStatus() {
    const [enabled, useAiClassifier, requireConfirmation, apiId, apiHash, session] =
      await Promise.all([
        this.getBoolSetting('TELEGRAM_USERBOT_ENABLED', false),
        this.getBoolSetting('TELEGRAM_USERBOT_USE_AI_CLASSIFIER', true),
        this.getBoolSetting('TELEGRAM_USERBOT_REQUIRE_CONFIRMATION', false),
        this.settings.get('TELEGRAM_USERBOT_API_ID'),
        this.settings.get('TELEGRAM_USERBOT_API_HASH'),
        this.settings.get('TELEGRAM_USERBOT_SESSION'),
      ]);
    const chatsTotal = await this.prisma.tgUserbotChat.count();
    const chatsEnabled = await this.prisma.tgUserbotChat.count({
      where: { enabled: true },
    });
    return {
      connected: await this.isClientAuthorized(this.client),
      enabled,
      useAiClassifier,
      requireConfirmation,
      credentials: {
        apiIdConfigured: Boolean(apiId?.trim()),
        apiHashConfigured: Boolean(apiHash?.trim()),
        sessionConfigured: Boolean(session?.trim()),
      },
      chatsTotal,
      chatsEnabled,
      pollMs: await this.getUserbotPollIntervalMs(),
      pollingInFlight: this.pollInFlight,
      processingQueueDepth: this.processingQueue.length,
      processingWorkersActive: this.processingWorkersActive,
      qr: this.qrState,
      balanceGuard: await this.getBalanceGuardSnapshot(),
    };
  }

  async getTodayMetrics() {
    const start = this.startOfToday();
    const [readMessages, signalsFound, signalsPlaced, parseIncomplete, parseError] =
      await Promise.all([
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start } },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, classification: 'signal' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'placed' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'parse_incomplete' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'parse_error' },
        }),
      ]);
    const recent = await this.prisma.tgUserbotIngest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: {
        id: true,
        chatId: true,
        messageId: true,
        text: true,
        aiRequest: true,
        aiResponse: true,
        classification: true,
        status: true,
        error: true,
        createdAt: true,
      },
    });
    return {
      dayStart: start.toISOString(),
      readMessages,
      signalsFound,
      signalsPlaced,
      noSignals: Math.max(0, readMessages - signalsFound),
      parseIncomplete,
      parseError,
      recent: recent.map((row) => ({
        ...row,
        isToday: row.createdAt.getTime() >= start.getTime(),
      })),
    };
  }

  async connectFromStoredSession() {
    const creds = await this.getApiCreds();
    const clientOptions = await this.getTelegramClientOptions();
    const session = (await this.settings.get('TELEGRAM_USERBOT_SESSION'))?.trim();
    if (!session) {
      return {
        ok: false,
        error: 'Сессия userbot не найдена. Запустите вход по QR.',
      };
    }
    await this.stopQrClient();
    const client = new TelegramClient(
      new StringSession(session),
      creds.apiId,
      creds.apiHash,
      clientOptions,
    );
    await client.connect();
    const authorized = await this.isClientAuthorized(client);
    if (!authorized) {
      await client.disconnect();
      return {
        ok: false,
        error: 'Сессия недействительна. Выполните повторный вход по QR.',
      };
    }
    await this.attachClient(client);
    await this.settings.set('TELEGRAM_USERBOT_ENABLED', 'true');
    return { ok: true, connected: true };
  }

  async disconnect() {
    if (!this.client) {
      return { ok: true, connected: false };
    }
    try {
      await this.client.disconnect();
    } finally {
      this.client = null;
      this.messageHandlerRegistered = false;
    }
    return { ok: true, connected: false };
  }

  async startQrLogin() {
    if (await this.isClientAuthorized(this.client)) {
      return {
        ok: true,
        message: 'Userbot уже авторизован.',
        qr: this.qrState,
      };
    }
    if (this.qrTask) {
      return { ok: true, message: 'QR-вход уже запущен.', qr: this.qrState };
    }

    const creds = await this.getApiCreds();
    const clientOptions = await this.getTelegramClientOptions();
    await this.stopQrClient();
    const qrClient = new TelegramClient(
      new StringSession(''),
      creds.apiId,
      creds.apiHash,
      clientOptions,
    );
    await qrClient.connect();
    this.qrClient = qrClient;
    this.setQrState({ phase: 'starting' });

    this.qrTask = (async () => {
      try {
        await qrClient.signInUserWithQrCode(
          { apiId: creds.apiId, apiHash: creds.apiHash },
          {
            onError: async (err: unknown) => {
              const msg = formatError(err);
              this.logger.warn(`Userbot QR onError: ${msg}`);
              this.setQrState({ phase: 'error', error: msg });
              return false;
            },
            qrCode: async (code: { token: Buffer }) => {
              const loginUrl = `tg://login?token=${code.token.toString('base64url')}`;
              const qrDataUrl = await QRCode.toDataURL(loginUrl);
              this.setQrState({
                phase: 'waiting_scan',
                loginUrl,
                qrDataUrl,
              });
            },
            password: async () =>
              (await this.settings.get('TELEGRAM_USERBOT_2FA_PASSWORD')) ?? '',
          },
        );
        const authorized = await this.isClientAuthorized(qrClient);
        if (!authorized) {
          this.setQrState({
            phase: 'error',
            error: 'QR авторизация не завершена.',
          });
          return;
        }
        const savedSession = (
          qrClient.session as unknown as { save: () => string }
        ).save();
        await this.settings.set('TELEGRAM_USERBOT_SESSION', savedSession);
        await this.settings.set('TELEGRAM_USERBOT_ENABLED', 'true');
        await this.attachClient(qrClient);
        this.qrClient = null;
        this.setQrState({ phase: 'authorized' });
      } catch (e) {
        const msg = formatError(e);
        this.logger.error(`Userbot QR flow failed: ${msg}`);
        this.setQrState({ phase: 'error', error: msg });
        await this.stopQrClient();
      } finally {
        this.qrTask = null;
      }
    })();

    return { ok: true, qr: this.qrState };
  }

  async getQrStatus() {
    return {
      connected: await this.isClientAuthorized(this.client),
      qr: this.qrState,
      inProgress: Boolean(this.qrTask),
    };
  }

  async cancelQrLogin() {
    await this.stopQrClient();
    this.qrTask = null;
    this.setQrState({ phase: 'cancelled' });
    return { ok: true, qr: this.qrState };
  }

  async syncChats() {
    if (!this.client || !(await this.isClientAuthorized(this.client))) {
      return { ok: false, error: 'Userbot не подключен.' };
    }
    const dialogs = (await this.client.getDialogs({
      limit: 1000,
    })) as unknown as Array<Record<string, unknown>>;
    let upserted = 0;

    for (const d of dialogs) {
      const entity = (d.entity ?? {}) as Record<string, unknown>;
      const className = this.readString(entity.className)?.toLowerCase();
      const isGroupLike =
        this.readBooleanish(d.isGroup) ||
        this.readBooleanish(d.isChannel) ||
        className === 'chat' ||
        className === 'channel';
      if (!isGroupLike) {
        continue;
      }

      const chatId = this.resolveChatIdFromDialog(d);
      const title =
        this.readString(d.title) ??
        this.readString(d.name) ??
        this.readString(entity.name) ??
        this.readString((d.entity as Record<string, unknown> | undefined)?.title) ??
        null;
      if (!chatId || !title) {
        continue;
      }
      const username = this.readString(
        (d.entity as Record<string, unknown> | undefined)?.username,
      );
      await this.prisma.tgUserbotChat.upsert({
        where: { chatId },
        create: { chatId, title, username, enabled: false },
        update: { title, username },
      });
      upserted += 1;
    }

    await this.refreshEnabledChatsCache();
    return { ok: true, upserted };
  }

  async listChats() {
    const [rows, bySource, tpSlBySource, tpSlRangeBySource, openrouterSpendTodayByChatId] =
      await Promise.all([
        this.prisma.tgUserbotChat.findMany({
          orderBy: [{ enabled: 'desc' }, { title: 'asc' }],
        }),
        this.getSourceMartingaleMap(),
        this.getSourceTpSlStepMap(),
        this.getSourceTpSlStepRangeMap(),
        this.getTodayOpenRouterSpendByChatId(),
      ]);
    return rows.map((row) => ({
      ...row,
      sourcePriority: this.normalizeSourcePriority((row as { sourcePriority?: number }).sourcePriority),
      martingaleMultiplier:
        bySource[row.title.trim().toLowerCase()] ?? null,
      tpSlStepStart: tpSlBySource[row.title.trim().toLowerCase()] ?? null,
      tpSlStepRange: tpSlRangeBySource[row.title.trim().toLowerCase()] ?? null,
      openrouterCostTodayUsd: openrouterSpendTodayByChatId[row.chatId] ?? 0,
    }));
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

  private extractOpenrouterCostUsd(
    payloadRaw: string | null,
  ): { chatId: string; costUsd: number } | null {
    if (!payloadRaw) return null;
    try {
      const payload = JSON.parse(payloadRaw) as {
        responseMeta?: {
          model?: unknown;
          cost?: unknown;
          costUsd?: unknown;
          generationCostUsd?: unknown;
          totalCost?: unknown;
          total_cost?: unknown;
          usage?: {
            cost?: unknown;
            costUsd?: unknown;
            totalCost?: unknown;
            total_cost?: unknown;
            promptTokens?: unknown;
            completionTokens?: unknown;
            prompt_tokens?: unknown;
            completion_tokens?: unknown;
          };
        };
        openrouterResponse?: {
          usage?: {
            cost?: unknown;
            totalCost?: unknown;
            total_cost?: unknown;
            promptTokens?: unknown;
            completionTokens?: unknown;
            prompt_tokens?: unknown;
            completion_tokens?: unknown;
          };
          model?: unknown;
        };
        logContext?: { chatId?: unknown };
      };
      const chatId = String(payload.logContext?.chatId ?? '').trim();
      if (!chatId) return null;
      const meta = payload.responseMeta ?? {};
      const usage = meta.usage ?? {};
      const fullResponse = payload.openrouterResponse ?? {};
      const fullUsage = fullResponse.usage ?? {};
      const candidate =
        this.parseNumberOrNull(meta.costUsd) ??
        this.parseNumberOrNull(meta.generationCostUsd) ??
        this.parseNumberOrNull(meta.cost) ??
        this.parseNumberOrNull(meta.totalCost) ??
        this.parseNumberOrNull(meta.total_cost) ??
        this.parseNumberOrNull(usage.costUsd) ??
        this.parseNumberOrNull(usage.cost) ??
        this.parseNumberOrNull(usage.totalCost) ??
        this.parseNumberOrNull(usage.total_cost) ??
        this.parseNumberOrNull(fullUsage.cost) ??
        this.parseNumberOrNull(fullUsage.totalCost) ??
        this.parseNumberOrNull(fullUsage.total_cost);
      if (candidate == null || candidate < 0) return null;
      return { chatId, costUsd: candidate };
    } catch {
      return null;
    }
  }

  private extractOpenrouterCostWithMeta(
    payloadRaw: string | null,
  ): { chatId: string; costUsd: number } | null {
    return this.extractOpenrouterCostUsd(payloadRaw);
  }

  private async getTodayOpenRouterSpendByChatId(): Promise<Record<string, number>> {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const rows = await this.prisma.openrouterGenerationCost.findMany({
      where: {
        status: 'resolved',
        costUsd: { not: null },
        createdAt: { gte: dayStart },
      },
      select: { chatId: true, costUsd: true },
    });
    const sums: Record<string, number> = {};
    for (const row of rows) {
      const chatId = String(row.chatId ?? '').trim();
      if (!chatId) continue;
      const costUsd = Number(row.costUsd ?? NaN);
      if (!Number.isFinite(costUsd) || costUsd < 0) continue;
      sums[chatId] = (sums[chatId] ?? 0) + costUsd;
    }
    return sums;
  }

  private resolveOpenrouterPeriodStart(period: OpenrouterSpendPeriod, now = new Date()): Date {
    const start = new Date(now);
    if (period === 'day') {
      start.setHours(0, 0, 0, 0);
      return start;
    }
    if (period === '3d') {
      start.setDate(start.getDate() - 2);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    if (period === 'week') {
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    if (period === 'month') {
      start.setMonth(start.getMonth() - 1);
      return start;
    }
    start.setFullYear(start.getFullYear() - 1);
    return start;
  }

  private bucketKeyByPeriod(d: Date, period: OpenrouterSpendPeriod): string {
    if (period === 'day') {
      return new Date(
        d.getFullYear(),
        d.getMonth(),
        d.getDate(),
        d.getHours(),
        0,
        0,
        0,
      ).toISOString();
    }
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
  }

  async getOpenrouterSpendAnalytics(period: OpenrouterSpendPeriod = 'day') {
    const safePeriod: OpenrouterSpendPeriod =
      period === 'day' ||
      period === '3d' ||
      period === 'week' ||
      period === 'month' ||
      period === 'year'
        ? period
        : 'day';
    const startAt = this.resolveOpenrouterPeriodStart(safePeriod);
    const endAt = new Date();
    const [rows, chats] = await Promise.all([
      this.prisma.openrouterGenerationCost.findMany({
        where: {
          status: 'resolved',
          costUsd: { not: null },
          createdAt: { gte: startAt, lte: endAt },
        },
        select: { createdAt: true, chatId: true, costUsd: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.tgUserbotChat.findMany({
        select: { chatId: true, title: true },
      }),
    ]);
    const titleByChatId = new Map<string, string>();
    for (const c of chats) {
      const chatId = String(c.chatId ?? '').trim();
      if (!chatId) continue;
      const title = String(c.title ?? '').trim();
      titleByChatId.set(chatId, title || chatId);
    }

    const sourceTotals = new Map<string, { chatId: string; source: string; totalUsd: number; requests: number }>();
    const bucketTotals = new Map<string, { at: string; totalUsd: number }>();
    let totalUsd = 0;
    let requests = 0;

    for (const row of rows) {
      const chatId = String(row.chatId ?? '').trim();
      const costUsd = Number(row.costUsd ?? NaN);
      if (!chatId || !Number.isFinite(costUsd) || costUsd < 0) continue;
      const sourceName = titleByChatId.get(chatId) ?? chatId;
      const currentSource = sourceTotals.get(chatId) ?? {
        chatId,
        source: sourceName,
        totalUsd: 0,
        requests: 0,
      };
      currentSource.totalUsd += costUsd;
      currentSource.requests += 1;
      sourceTotals.set(chatId, currentSource);

      const createdAtRaw = row.createdAt;
      const createdAt =
        createdAtRaw instanceof Date ? createdAtRaw : new Date(String(createdAtRaw ?? ''));
      if (!Number.isFinite(createdAt.getTime())) continue;
      const bucketKey = this.bucketKeyByPeriod(createdAt, safePeriod);
      const currentBucket = bucketTotals.get(bucketKey) ?? { at: bucketKey, totalUsd: 0 };
      currentBucket.totalUsd += costUsd;
      bucketTotals.set(bucketKey, currentBucket);

      totalUsd += costUsd;
      requests += 1;
    }

    return {
      period: safePeriod,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      totalUsd: Number(totalUsd.toFixed(8)),
      requests,
      bySource: Array.from(sourceTotals.values())
        .map((s) => ({
          ...s,
          avgUsd: s.requests > 0 ? Number((s.totalUsd / s.requests).toFixed(8)) : 0,
          totalUsd: Number(s.totalUsd.toFixed(8)),
        }))
        .sort((a, b) => b.totalUsd - a.totalUsd),
      timeline: Array.from(bucketTotals.values())
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
        .map((p) => ({ ...p, totalUsd: Number(p.totalUsd.toFixed(8)) })),
    };
  }

  async getOpenrouterBalance() {
    const snapshot = await this.transcript.getOpenrouterBalance();
    const thresholdUsd = OPENROUTER_BALANCE_LOW_THRESHOLD_USD;
    const balanceUsd = snapshot.balanceUsd;
    const lowBalance =
      balanceUsd != null &&
      Number.isFinite(balanceUsd) &&
      balanceUsd < thresholdUsd;
    if (lowBalance && balanceUsd != null) {
      await this.notifyOpenrouterLowBalance(balanceUsd, thresholdUsd);
    }
    return {
      ...snapshot,
      lowBalance,
      thresholdUsd,
    };
  }

  private async notifyOpenrouterLowBalance(balanceUsd: number, thresholdUsd: number): Promise<void> {
    const dedupKey = `openrouter-low-balance:${thresholdUsd}`;
    const now = Date.now();
    const prev = this.lastCriticalNotifyAtByKey.get(dedupKey) ?? 0;
    if (now - prev < OPENROUTER_BALANCE_NOTIFY_COOLDOWN_MS) {
      return;
    }
    this.lastCriticalNotifyAtByKey.set(dedupKey, now);
    const text =
      `[CRITICAL OPENROUTER LOW BALANCE]\n` +
      `balanceUsd=${balanceUsd.toFixed(4)}\n` +
      `thresholdUsd=${thresholdUsd.toFixed(2)}`;
    try {
      const res = await fetch(CRITICAL_NOTIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        this.logger.warn(`openrouter low balance notify failed: status=${res.status}`);
      }
    } catch (e) {
      this.logger.warn(`openrouter low balance notify error: ${formatError(e)}`);
    }
  }

  private parseSourceMartingaleMap(raw: string | undefined): SourceMartingaleMap {
    const out: SourceMartingaleMap = {};
    const text = String(raw ?? '').trim();
    if (!text) {
      return out;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return out;
      }
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const key = String(k ?? '').trim().toLowerCase();
        const n = Number(v);
        if (!key || !Number.isFinite(n) || n <= 1) {
          continue;
        }
        out[key] = n;
      }
    } catch {
      return {};
    }
    return out;
  }

  private async getSourceMartingaleMap(): Promise<SourceMartingaleMap> {
    const raw = await this.settings.get('SOURCE_MARTINGALE_MULTIPLIERS');
    return this.parseSourceMartingaleMap(raw);
  }

  private takeSourceTpMapSkipLogSlot(
    kind: 'start' | 'range',
    entryKey: string,
    val: unknown,
  ): boolean {
    const sig = `${kind}:${entryKey}:${JSON.stringify(val)}`;
    if (this.sourceTpMapSkipLogged.has(sig)) {
      return false;
    }
    if (
      this.sourceTpMapSkipLogged.size >=
      TelegramUserbotService.SOURCE_MAP_SKIP_LOG_CAP
    ) {
      this.sourceTpMapSkipLogged.clear();
    }
    this.sourceTpMapSkipLogged.add(sig);
    return true;
  }

  private async getSourceTpSlStepMap(): Promise<SourceTpSlStepMap> {
    const raw = await this.settings.get('SOURCE_TP_SL_STEP_START');
    return parseSourceTpSlStepMap(raw, (kind, entryKey, val) => {
      if (!this.takeSourceTpMapSkipLogSlot(kind, entryKey, val)) {
        return;
      }
      this.logger.warn(
        `Userbot SOURCE_TP_SL_STEP_START: пропущена невалидная запись key=${JSON.stringify(entryKey)} value=${JSON.stringify(val)}`,
      );
    });
  }

  private async getSourceTpSlStepRangeMap(): Promise<SourceTpSlStepRangeMap> {
    const raw = await this.settings.get('SOURCE_TP_SL_STEP_RANGE');
    return parseSourceTpSlStepRangeMap(raw, (kind, entryKey, val) => {
      if (!this.takeSourceTpMapSkipLogSlot(kind, entryKey, val)) {
        return;
      }
      this.logger.warn(
        `Userbot SOURCE_TP_SL_STEP_RANGE: пропущена невалидная запись key=${JSON.stringify(entryKey)} value=${JSON.stringify(val)}`,
      );
    });
  }

  private async setSourceTpSlStepStart(
    sourceName: string,
    mode: TpSlStepStartMode | null,
  ): Promise<void> {
    const source = sourceName.trim().toLowerCase();
    if (!source) {
      return;
    }
    const map = await this.getSourceTpSlStepMap();
    if (mode === null) {
      delete map[source];
    } else {
      map[source] = mode;
    }
    await this.settings.set('SOURCE_TP_SL_STEP_START', JSON.stringify(map));
  }

  private async setSourceTpSlStepRange(
    sourceName: string,
    range: number | null,
  ): Promise<void> {
    const source = sourceName.trim().toLowerCase();
    if (!source) {
      return;
    }
    const map = await this.getSourceTpSlStepRangeMap();
    if (range === null || !Number.isFinite(range)) {
      delete map[source];
    } else {
      const n = Math.trunc(range);
      if (n < 1 || n > 5) {
        delete map[source];
      } else {
        map[source] = n;
      }
    }
    await this.settings.set('SOURCE_TP_SL_STEP_RANGE', JSON.stringify(map));
  }

  private async setSourceMartingaleMultiplier(
    sourceName: string,
    multiplier: number | null,
  ): Promise<void> {
    const source = sourceName.trim().toLowerCase();
    if (!source) {
      return;
    }
    const map = await this.getSourceMartingaleMap();
    if (multiplier == null || !Number.isFinite(multiplier) || multiplier <= 1) {
      delete map[source];
    } else {
      map[source] = Math.round(multiplier * 1_000_000) / 1_000_000;
    }
    await this.settings.set('SOURCE_MARTINGALE_MULTIPLIERS', JSON.stringify(map));
  }

  async listPublishGroups() {
    const prismaAny = this.prisma as any;
    const rows = await prismaAny.tgUserbotPublishGroup.findMany({
      orderBy: [{ enabled: 'desc' }, { title: 'asc' }],
    });
    return { items: rows };
  }

  async createOrUpdatePublishGroup(body: {
    id?: string;
    title?: string;
    chatId?: string;
    enabled?: boolean;
    publishEveryN?: number;
  }) {
    const title = body.title?.trim() ?? '';
    const chatId = body.chatId?.trim() ?? '';
    const enabled = body.enabled !== false;
    const publishEveryN = Math.max(1, Math.trunc(Number(body.publishEveryN ?? 1) || 1));
    if (!title) return { ok: false, error: 'title обязателен' };
    if (!chatId) return { ok: false, error: 'chatId обязателен' };

    if (body.id?.trim()) {
      const id = body.id.trim();
      const prismaAny = this.prisma as any;
      const updated = await prismaAny.tgUserbotPublishGroup.update({
        where: { id },
        data: { title, chatId, enabled, publishEveryN },
      });
      return { ok: true, item: updated };
    }

    const prismaAny = this.prisma as any;
    const created = await prismaAny.tgUserbotPublishGroup.create({
      data: { title, chatId, enabled, publishEveryN },
    });
    return { ok: true, item: created };
  }

  async deletePublishGroup(id: string) {
    const v = id.trim();
    if (!v) return { ok: false, error: 'id обязателен' };
    const prismaAny = this.prisma as any;
    await prismaAny.tgUserbotPublishGroup.delete({ where: { id: v } });
    return { ok: true };
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

  async listFilterGroups() {
    const chatRows = await this.prisma.tgUserbotChat.findMany({
      where: { enabled: true },
      orderBy: { title: 'asc' },
      select: { title: true },
    });
    const names = new Set<string>();
    for (const row of chatRows) {
      const v = typeof row.title === 'string' ? row.title.trim() : '';
      if (v) names.add(String(v));
    }
    return {
      groups: Array.from(names).sort((a, b) => a.localeCompare(b, 'ru')),
    };
  }

  async listFilterExamples() {
    const rows = await this.prisma.tgUserbotFilterExample.findMany({
      where: { enabled: true },
      orderBy: [{ groupName: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        groupName: true,
        kind: true,
        example: true,
        requiresQuote: true,
        createdAt: true,
      },
    });
    return { items: rows };
  }

  async listFilterPatterns() {
    const rows = await this.prisma.tgUserbotFilterPattern.findMany({
      where: { enabled: true },
      orderBy: [{ groupName: 'asc' }, { kind: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        groupName: true,
        kind: true,
        pattern: true,
        requiresQuote: true,
        createdAt: true,
      },
    });
    return { items: rows };
  }

  async createFilterExample(body: {
    groupName?: string;
    kind?: 'signal' | 'close' | 'result' | 'reentry';
    example?: string;
    requiresQuote?: boolean;
  }) {
    const groupName = body.groupName?.trim() ?? '';
    const kind = body.kind;
    const example = body.example?.trim() ?? '';
    const requiresQuote = body.requiresQuote === true;
    if (!groupName) {
      return { ok: false, error: 'groupName обязателен' };
    }
    if (kind !== 'signal' && kind !== 'close' && kind !== 'result' && kind !== 'reentry') {
      return { ok: false, error: 'kind должен быть signal | close | result | reentry' };
    }
    if (example.length < 6) {
      return { ok: false, error: 'example слишком короткий (минимум 6 символов)' };
    }
    const created = await this.prisma.tgUserbotFilterExample.create({
      data: { groupName, kind, example, requiresQuote, enabled: true },
      select: {
        id: true,
        groupName: true,
        kind: true,
        example: true,
        requiresQuote: true,
        createdAt: true,
      },
    });
    return { ok: true, item: created };
  }

  async deleteFilterExample(id: string) {
    await this.prisma.tgUserbotFilterExample.update({
      where: { id },
      data: { enabled: false },
    });
    return { ok: true };
  }

  async createFilterPattern(body: {
    groupName?: string;
    kind?: 'signal' | 'close' | 'result' | 'reentry';
    pattern?: string;
    requiresQuote?: boolean;
  }) {
    const groupName = body.groupName?.trim() ?? '';
    const kind = body.kind;
    const pattern = body.pattern?.trim() ?? '';
    const requiresQuote = body.requiresQuote === true;
    if (!groupName) {
      return { ok: false, error: 'groupName обязателен' };
    }
    if (kind !== 'signal' && kind !== 'close' && kind !== 'result' && kind !== 'reentry') {
      return { ok: false, error: 'kind должен быть signal | close | result | reentry' };
    }
    if (pattern.length < 2) {
      return { ok: false, error: 'pattern слишком короткий (минимум 2 символа)' };
    }
    const created = await this.prisma.tgUserbotFilterPattern.create({
      data: { groupName, kind, pattern, requiresQuote, enabled: true },
      select: {
        id: true,
        groupName: true,
        kind: true,
        pattern: true,
        requiresQuote: true,
        createdAt: true,
      },
    });
    return { ok: true, item: created };
  }

  async deleteFilterPattern(id: string) {
    await this.prisma.tgUserbotFilterPattern.update({
      where: { id },
      data: { enabled: false },
    });
    return { ok: true };
  }

  async generateFilterPatterns(body: {
    kind?: 'signal' | 'close' | 'result' | 'reentry';
    example?: string;
  }) {
    const kind = body.kind;
    const example = body.example?.trim() ?? '';
    if (kind !== 'signal' && kind !== 'close' && kind !== 'result' && kind !== 'reentry') {
      return { ok: false, error: 'kind должен быть signal | close | result | reentry' };
    }
    if (example.length < 6) {
      return { ok: false, error: 'example слишком короткий (минимум 6 символов)' };
    }
    return this.transcript.generateFilterPatterns({ kind, example });
  }

  async scanTodayMessages(limitPerChatRaw?: number) {
    return this.scanTodayMessagesCore(limitPerChatRaw, true);
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
      },
    });
    if (!ingest) {
      return { ok: false, error: 'Сообщение не найдено' };
    }
    const text = this.readString(ingest.text);
    if (!text) {
      return { ok: false, error: 'В сообщении нет текстового содержимого для перечитывания' };
    }
    await this.processIngestRecord(ingest, text, undefined, {
      source: 'manual-reread',
    });
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
      },
    });
    let processed = 0;
    let skippedWithoutText = 0;
    let failed = 0;
    const errors: Array<{ ingestId: string; error: string }> = [];

    for (const row of rows) {
      const text = this.readString(row.text);
      if (!text) {
        skippedWithoutText += 1;
        continue;
      }
      try {
        await this.processIngestRecord(row, text, undefined, {
          source: 'manual-reread-all',
        });
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

  private async scanTodayMessagesCore(
    limitPerChatRaw?: number,
    includeTodayMetrics = false,
  ) {
    if (!this.client || !(await this.isClientAuthorized(this.client))) {
      return { ok: false, error: 'Userbot не подключен.' };
    }
    const enabledChats = await this.prisma.tgUserbotChat.findMany({
      where: { enabled: true },
      select: { chatId: true, title: true },
    });
    const limitPerChat =
      typeof limitPerChatRaw === 'number' && Number.isFinite(limitPerChatRaw)
        ? Math.max(20, Math.min(500, Math.floor(limitPerChatRaw)))
        : USERBOT_POLL_FETCH_LIMIT;
    const start = this.startOfToday();
    let readMessages = 0;
    let readTextMessages = 0;
    let chatsProcessed = 0;
    const errors: Array<{ chatId: string; error: string }> = [];

    for (const chat of enabledChats) {
      try {
        const list = (await this.client.getMessages(chat.chatId, {
          limit: limitPerChat,
        })) as unknown as Array<Record<string, unknown>>;
        chatsProcessed += 1;
        const lastSeenMessageId = this.lastSeenMessageIds.get(chat.chatId) ?? 0;
        const candidates = list
          .map((m) => {
            const createdAt = this.extractMessageDate(m.date);
            const text = this.readString(m.message);
            const messageId = this.readNumericString(m.id);
            const messageIdNum = messageId ? Number(messageId) : NaN;
            return {
              createdAt,
              text,
              messageId,
              messageIdNum,
              replyToMessageId: this.extractReplyToMessageId(
                m.replyTo ?? m.reply_to ?? m.replyToMsgId ?? m.reply_to_msg_id,
              ),
            };
          })
          .filter((row) => {
            if (!row.createdAt || row.createdAt < start) {
              return false;
            }
            if (!row.text || !row.messageId || !Number.isFinite(row.messageIdNum)) {
              return false;
            }
            return row.messageIdNum > lastSeenMessageId;
          })
          .sort((a, b) => a.messageIdNum - b.messageIdNum);

        for (const m of candidates) {
          if (!(await this.isMessageRecent(m.createdAt!))) {
            continue;
          }
          readMessages += 1;
          readTextMessages += 1;
          this.noteLastSeenMessageId(chat.chatId, m.messageIdNum);
          await this.ingestChatMessage(
            chat.chatId,
            m.messageId!,
            m.text!,
            {
              replyToMessageId: m.replyToMessageId,
              signalExternalId: this.extractSignalExternalId(m.text),
            },
            {
              source: 'poll',
              telegramReceivedAt: m.createdAt!,
            },
          );
        }
      } catch (e) {
        errors.push({ chatId: chat.chatId, error: formatError(e) });
      }
    }

    const today = includeTodayMetrics ? await this.getTodayMetrics() : undefined;
    return {
      ok: true,
      chatsProcessed,
      enabledChats: enabledChats.length,
      limitPerChat,
      readMessages,
      readTextMessages,
      errors,
      today,
    };
  }

  private async startPollingLoop() {
    if (this.pollTimer) {
      return;
    }
    const pollMs = await this.getUserbotPollIntervalMs();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.pollTick().finally(() => {
        void this.startPollingLoop();
      });
    }, pollMs);
  }

  private stopPollingLoop() {
    if (!this.pollTimer) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private async getUserbotPollIntervalMs(): Promise<number> {
    return this.getNumberSetting(
      'TELEGRAM_USERBOT_POLL_INTERVAL_MS',
      USERBOT_POLL_INTERVAL_MS,
      500,
      60_000,
    );
  }

  private async pollTick() {
    if (this.pollInFlight) {
      return;
    }
    if (!this.client || !(await this.isClientAuthorized(this.client))) {
      return;
    }
    if (this.enabledChatIds.size === 0) {
      return;
    }
    this.pollInFlight = true;
    try {
      await this.scanTodayMessagesCore(USERBOT_POLL_FETCH_LIMIT, false);
    } catch (e) {
      this.logger.warn(`Userbot pollTick failed: ${formatError(e)}`);
    } finally {
      this.pollInFlight = false;
    }
  }

  async updateChat(
    chatId: string,
    body: {
      enabled?: boolean;
      defaultLeverage?: number | null;
      defaultEntryUsd?: string | null;
      martingaleMultiplier?: number | null;
      sourcePriority?: number | null;
      /** null = наследовать глобальный BUMP_TO_MIN_EXCHANGE_LOT */
      minLotBump?: boolean | null;
      /** null = наследовать глобальный TP_SL_STEP_START; иначе off | tp1..tp5 */
      tpSlStepStart?: string | null;
      /** null = сбросить переопределение и наследовать глобальный TP_SL_STEP_RANGE; иначе 1..5 */
      tpSlStepRange?: number | null;
    },
  ) {
    const entryNorm =
      body.defaultEntryUsd !== undefined
        ? body.defaultEntryUsd === null || body.defaultEntryUsd.trim() === ''
          ? null
          : body.defaultEntryUsd.trim()
        : undefined;
    const levNorm =
      body.defaultLeverage === undefined
        ? undefined
        : body.defaultLeverage === null
          ? null
          : body.defaultLeverage >= 1
            ? Math.floor(body.defaultLeverage)
            : null;
    const martingaleNorm =
      body.martingaleMultiplier === undefined
        ? undefined
        : body.martingaleMultiplier === null
          ? null
          : Number.isFinite(body.martingaleMultiplier) &&
              body.martingaleMultiplier > 1
            ? Math.round(body.martingaleMultiplier * 1_000_000) / 1_000_000
            : null;
    const sourcePriorityNorm =
      body.sourcePriority === undefined
        ? undefined
        : body.sourcePriority === null
          ? 0
          : Number.isFinite(body.sourcePriority)
            ? Math.max(0, Math.floor(body.sourcePriority))
            : 0;
    const minLotBumpNorm =
      body.minLotBump === undefined
        ? undefined
        : body.minLotBump === null
          ? null
          : Boolean(body.minLotBump);

    const prismaAny = this.prisma as any;
    const row = await prismaAny.tgUserbotChat.upsert({
      where: { chatId },
      create: {
        chatId,
        title: chatId,
        enabled: body.enabled === true,
        sourcePriority: sourcePriorityNorm ?? 0,
        defaultLeverage: levNorm ?? null,
        defaultEntryUsd: entryNorm ?? null,
        minLotBump: minLotBumpNorm ?? null,
      },
      update: {
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(sourcePriorityNorm !== undefined ? { sourcePriority: sourcePriorityNorm } : {}),
        ...(levNorm !== undefined ? { defaultLeverage: levNorm } : {}),
        ...(entryNorm !== undefined ? { defaultEntryUsd: entryNorm } : {}),
        ...(minLotBumpNorm !== undefined ? { minLotBump: minLotBumpNorm } : {}),
      },
    });
    if (martingaleNorm !== undefined) {
      const rowTitle = String(row?.title ?? chatId);
      await this.setSourceMartingaleMultiplier(rowTitle, martingaleNorm);
    }

    if (body.tpSlStepStart !== undefined) {
      const rowTitle = String(row?.title ?? chatId);
      const raw = body.tpSlStepStart;
      if (raw === null || String(raw).trim() === '') {
        await this.setSourceTpSlStepStart(rowTitle, null);
      } else {
        await this.setSourceTpSlStepStart(
          rowTitle,
          parseTpSlStepStart(String(raw)),
        );
      }
    }

    if (body.tpSlStepRange !== undefined) {
      const rowTitle = String(row?.title ?? chatId);
      const r = body.tpSlStepRange;
      if (r === null) {
        await this.setSourceTpSlStepRange(rowTitle, null);
      } else {
        if (!Number.isFinite(r)) {
          throw new BadRequestException(
            'tpSlStepRange: ожидается null или целое 1–5',
          );
        }
        const n = Math.trunc(r as number);
        if (n < 1 || n > 5) {
          throw new BadRequestException(
            `tpSlStepRange: ожидается целое 1–5, получено ${JSON.stringify(r)}`,
          );
        }
        await this.setSourceTpSlStepRange(rowTitle, n);
      }
    }

    await this.refreshEnabledChatsCache();
    return { ok: true };
  }

  private async buildTranscriptParseOverrides(
    chatId: string,
  ): Promise<TranscriptParseOverrides> {
    const [chat, details] = await Promise.all([
      this.prisma.tgUserbotChat.findUnique({
        where: { chatId },
        select: { defaultLeverage: true, defaultEntryUsd: true },
      }),
      this.bybit.getUnifiedUsdtBalanceDetails(),
    ]);
    const defaultOrderUsd = await this.settings.resolveDefaultEntryUsd({
      rawOverride: chat?.defaultEntryUsd,
      balanceTotalUsd: details?.totalUsd,
    });
    const leverageDefault =
      chat?.defaultLeverage != null && chat.defaultLeverage >= 1
        ? chat.defaultLeverage
        : undefined;
    return {
      defaultOrderUsd,
      leverageDefault,
    };
  }

  private async attachClient(client: TelegramClient): Promise<void> {
    if (this.client && this.client !== client) {
      await this.client.disconnect();
      this.messageHandlerRegistered = false;
    }
    this.client = client;
    if (!this.messageHandlerRegistered) {
      this.client.addEventHandler(
        this.handleIncomingMessage,
        new NewMessage({ incoming: true }),
      );
      this.messageHandlerRegistered = true;
    }
    await this.refreshEnabledChatsCache();
  }

  private readonly handleIncomingMessage = async (event: unknown) => {
    try {
      const rawEvent = event as Record<string, unknown>;
      const msg = rawEvent.message as Record<string, unknown> | undefined;
      const messageId = this.readNumber(msg?.id);
      const chatId = this.resolveChatIdFromEvent(rawEvent, msg);
      const text = this.readString(msg?.message);
      const replyToMessageId = this.extractReplyToMessageId(
        msg?.replyTo ?? msg?.reply_to ?? msg?.replyToMsgId ?? msg?.reply_to_msg_id,
      );
      const createdAt = this.extractMessageDate(msg?.date);
      if (!chatId || messageId == null || !text?.trim() || !createdAt) {
        return;
      }
      if (!this.isToday(createdAt)) {
        return;
      }
      if (!(await this.isMessageRecent(createdAt))) {
        return;
      }
      if (!this.enabledChatIds.has(chatId)) {
        return;
      }
      this.noteLastSeenMessageId(chatId, messageId);
      await this.ingestChatMessage(
        chatId,
        String(messageId),
        text.trim(),
        {
          replyToMessageId,
          signalExternalId: this.extractSignalExternalId(text),
        },
        {
          source: 'realtime',
          telegramReceivedAt: createdAt,
        },
      );
    } catch (e) {
      const msg = formatError(e);
      this.logger.error(`handleIncomingMessage failed: ${msg}`);
    }
  };

  private async ingestChatMessage(
    chatId: string,
    messageId: string,
    text: string,
    meta?: { replyToMessageId?: string; signalExternalId?: string },
    options?: ProcessIngestOptions,
  ): Promise<void> {
    const dedupMessageKey = `${chatId}:${messageId}`;
    const ingest = await this.tryCreateIngestRow({
      chatId,
      messageId,
      dedupMessageKey,
      text,
      classification: 'other',
      status: 'ignored',
    });
    if (!ingest) {
      void this.appLog.append('debug', 'telegram', 'Userbot: duplicate ingest skipped', {
        chatId,
        messageId,
        dedupMessageKey,
      });
      return;
    }

    this.enqueueIngestJob({
      ingest: {
        id: ingest.id,
        chatId: ingest.chatId,
        messageId: ingest.messageId,
        signalHash: null,
        status: ingest.status,
      },
      text: text.length > USERBOT_INLINE_TEXT_MAX_CHARS ? null : text,
      textLen: text.length,
      meta,
      options: {
        enforceBalanceGuard: true,
        ...options,
        ingestCreatedAt: ingest.createdAt,
      },
    });
  }

  private enqueueIngestJob(job: IngestProcessJob): void {
    if (this.processingQueuedIds.has(job.ingest.id)) {
      return;
    }
    // Ставим "замок" сразу, чтобы не было гонки и дубликатов при async-проверке лимита.
    this.processingQueuedIds.add(job.ingest.id);

    // Защита от неконтролируемого роста памяти: ограничиваем очередь.
    // При переполнении помечаем ingest как ignored с причиной "overloaded".
    void (async () => {
      const maxQueue = await this.getNumberSetting(
        'TELEGRAM_USERBOT_MAX_QUEUE',
        USERBOT_MAX_QUEUE_DEFAULT,
        10,
        10_000,
      );
      if (this.processingQueue.length >= maxQueue) {
        this.processingQueuedIds.delete(job.ingest.id);
        void this.appLog.append(
          'warn',
          'telegram',
          'Userbot: processing queue overflow, dropping ingest',
          {
            ingestId: job.ingest.id,
            chatId: job.ingest.chatId,
            queueDepth: this.processingQueue.length,
            maxQueue,
            textLen: job.textLen,
          },
        );
        await this.updateIngest(job.ingest.id, {
          status: 'ignored',
          classification: 'other',
          error: `Очередь обработки переполнена (>${maxQueue}). Сообщение пропущено.`,
        }).catch(() => undefined);
        return;
      }
      this.processingQueue.push({
        ...job,
        options: {
          ...job.options,
          enqueuedAtMs: Date.now(),
        },
      });
      this.pumpIngestQueue();
    })().catch((e) => {
      // При ошибке не держим "замок" навсегда.
      this.processingQueuedIds.delete(job.ingest.id);
      this.logger.warn(`enqueueIngestJob failed: ${formatError(e)}`);
    });
  }

  private pumpIngestQueue(): void {
    while (
      this.processingWorkersActive < USERBOT_PROCESSING_CONCURRENCY &&
      this.processingQueue.length > 0
    ) {
      const job = this.processingQueue.shift();
      if (!job) {
        return;
      }
      this.processingQueuedIds.delete(job.ingest.id);
      this.processingWorkersActive += 1;
      void this.runIngestJob(job).finally(() => {
        this.processingWorkersActive -= 1;
        this.pumpIngestQueue();
      });
    }
  }

  private async runIngestJob(job: IngestProcessJob): Promise<void> {
    try {
      let text = job.text;
      if (text == null) {
        const row = await this.prisma.tgUserbotIngest.findUnique({
          where: { id: job.ingest.id },
          select: { text: true },
        });
        text = row?.text ?? '';
      }
      await this.processIngestRecord(
        job.ingest,
        text,
        job.meta,
        job.options,
      );
    } catch (e) {
      const error = formatError(e);
      this.logger.error(`runIngestJob failed ingest=${job.ingest.id}: ${error}`);
      await this.updateIngest(job.ingest.id, {
        classification: 'other',
        status: 'ignored',
        error,
      });
    }
  }

  private noteLastSeenMessageId(chatId: string, messageId: number): void {
    const prev = this.lastSeenMessageIds.get(chatId) ?? 0;
    if (messageId > prev) {
      this.lastSeenMessageIds.set(chatId, messageId);
    }
  }

  private async processIngestRecord(
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
        textPreview: this.makeTextPreview(text),
        source: options?.source ?? null,
        queueDelayMs,
        telegramReceivedAt: options?.telegramReceivedAt?.toISOString() ?? null,
        ingestCreatedAt: options?.ingestCreatedAt?.toISOString() ?? null,
        processingStartedAt: processingStartedAt.toISOString(),
        processingQueueDepth: this.processingQueue.length,
        processingWorkersActive: this.processingWorkersActive,
      });
      await this.updateIngest(ingest.id, {
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
          await this.updateIngest(ingest.id, {
            classification: 'other',
            status: 'ignored',
            error: lowBalance.reason,
            aiRequest: null,
            aiResponse: null,
          });
          return;
        }
      }

      const lockEmojiCount = this.countLockEmojiInText(text);
      if (lockEmojiCount > 5) {
        const reason =
          'Сообщение содержит 🔐 более 5 раз — не обрабатывается как сигнал, результат, перезаход или закрытие';
        this.appendIngestStageLog('info', 'Userbot: skipped — lock emoji spam', ingest, {
          lockEmojiCount,
          textPreview: this.makeTextPreview(text),
        });
        await this.updateIngest(ingest.id, {
          classification: 'other',
          status: 'ignored',
          error: reason,
          aiRequest: null,
          aiResponse: null,
        });
        return;
      }

      const chatMetaRaw = await (this.prisma as any).tgUserbotChat.findUnique({
        where: { chatId: ingest.chatId },
        select: { title: true, sourcePriority: true },
      });
      const chatMeta = chatMetaRaw as
        | { title?: string | null; sourcePriority?: number | null }
        | null;
      const groupName = chatMeta?.title?.trim() || ingest.chatId;
      const replyToMessageId = meta?.replyToMessageId?.trim() || undefined;
      const signalExternalId =
        meta?.signalExternalId?.trim() || this.extractSignalExternalId(text) || undefined;
      const hasQuotedSource = Boolean(replyToMessageId);
      const patternMatch = await this.matchFilterKindByPatterns(
        groupName,
        text,
        hasQuotedSource,
      );
      const exampleMatch = patternMatch
        ? undefined
        : await this.matchFilterKindByExamples(groupName, text, hasQuotedSource);
      const filterKind = patternMatch?.kind;
      const exampleKind = exampleMatch?.kind;
      if (patternMatch) {
        this.appendIngestStageLog('info', 'Userbot: matched filter pattern', ingest, {
          groupName,
          matchedKind: patternMatch.kind,
          matchedPattern: patternMatch.pattern,
          requiresQuote: patternMatch.requiresQuote,
          hasQuotedSource,
          textPreview: this.makeTextPreview(text),
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
          textPreview: this.makeTextPreview(text),
        });
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
        const note = this.limitTrace(
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
        await this.updateIngest(ingest.id, {
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
        await this.updateIngest(ingest.id, {
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
          await this.publishOutcomeToMirrorGroups({
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
        await this.updateIngest(ingest.id, {
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
          await this.publishOutcomeToMirrorGroups({
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
        await this.updateIngest(ingest.id, {
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
      const parseOverrides = await this.buildTranscriptParseOverrides(ingest.chatId);
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
        await this.updateIngest(ingest.id, {
          classification: parsed.ok === 'incomplete' ? 'other' : 'signal',
          status: parsed.ok === 'incomplete' ? 'ignored' : 'parse_error',
          error: parseError,
          aiRequest,
          aiResponse,
        });
        await this.notifySignalFailureToBot({
          ingestId: ingest.id,
          chatId: ingest.chatId,
          token: this.extractTokenHint(text),
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
      await this.publishSignalToMirrorGroups({
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
        await this.updateIngest(ingest.id, {
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
        const incomingPriority = this.normalizeSourcePriority(chatMeta?.sourcePriority);
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
              await this.updateIngest(ingest.id, {
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
            await this.updateIngest(ingest.id, {
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
          await this.updateIngest(ingest.id, {
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
        await this.updateIngest(ingest.id, {
          classification: 'signal',
          status: 'duplicate_signal',
          signalHash,
          error: 'Сигнал уже обрабатывался ранее',
          aiRequest,
          aiResponse,
        });
        return;
      }

      const requireConfirmation = await this.getBoolSetting(
        'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION',
        false,
      );
      if (requireConfirmation) {
        this.appendIngestStageLog('info', 'Userbot: waiting external confirmation', ingest, {
          signalHash,
          pair: signal.pair,
          direction: signal.direction,
        });
        await this.updateIngest(ingest.id, {
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
          signalId?: string;
          bybitOrderIds?: string[];
          actorUserId?: number;
        }) => {
          if (result.decision === 'rejected') {
            this.appendIngestStageLog('info', 'Userbot: confirmation rejected by user', ingest, {
              actorUserId: result.actorUserId ?? null,
            });
            await this.updateIngest(ingest.id, {
              status: 'cancelled_by_confirmation',
              error: `Отклонено пользователем ${result.actorUserId ?? ''}`.trim(),
            });
            return;
          }
          if (!result.ok) {
            this.appendIngestStageLog('error', 'Userbot: confirmation accepted but placement failed', ingest, {
              error: result.error ?? 'unknown',
            });
            await this.updateIngest(ingest.id, {
              status: 'place_error',
              error:
                result.error ??
                'Подтверждение получено, но ордер не удалось выставить',
            });
            return;
          }
          this.appendIngestStageLog('info', 'Userbot: confirmation accepted and placement succeeded', ingest, {
            actorUserId: result.actorUserId ?? null,
          });
          await this.updateIngest(ingest.id, {
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
          await this.updateIngest(ingest.id, {
            error: `Ожидание подтверждения: ${req.error ?? 'не удалось отправить запрос в бот'}`,
          });
        } else {
          this.appendIngestStageLog('info', 'Userbot: confirmation request sent', ingest, {
            deliveredTo: req.deliveredTo,
          });
          await this.updateIngest(ingest.id, {
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
        await this.updateIngest(ingest.id, {
          classification: 'signal',
          status: 'place_error',
          signalHash,
          error: placeError,
          aiRequest,
          aiResponse,
        });
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
      await this.updateIngest(ingest.id, {
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
      await this.updateIngest(ingest.id, {
        status: 'parse_error',
        error: normalizedErr,
      });
      if (!isCriticalClassify) {
        await this.notifySignalFailureToBot({
          ingestId: ingest.id,
          chatId: ingest.chatId,
          token: this.extractTokenHint(text),
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

  private async matchFilterKindByExamples(
    groupName: string,
    text: string,
    hasQuotedSource: boolean,
  ): Promise<UserbotFilterExampleMatch | undefined> {
    const rows = await this.prisma.tgUserbotFilterExample.findMany({
      where: { enabled: true },
      select: { groupName: true, kind: true, example: true, requiresQuote: true },
    });
    const target = groupName.trim().toLowerCase();
    const scoped = rows.filter((row) => {
      const name = typeof row.groupName === 'string' ? row.groupName.trim().toLowerCase() : '';
      return name === target;
    });
    if (scoped.length === 0) {
      return undefined;
    }

    let bestKind: UserbotFilterKind | undefined;
    let bestScore = 0;
    let bestExampleText = '';
    let bestRequiresQuote = false;
    for (const row of scoped) {
      const kind = row.kind as UserbotFilterKind;
      const exampleText = typeof row.example === 'string' ? row.example : '';
      const requiresQuote = row.requiresQuote === true;
      if (kind !== 'signal' && kind !== 'close' && kind !== 'result' && kind !== 'reentry') {
        continue;
      }
      if ((kind === 'close' || kind === 'reentry') && !hasQuotedSource) {
        continue;
      }
      if (requiresQuote && !hasQuotedSource) {
        continue;
      }
      if (!exampleText) {
        continue;
      }
      const score = this.computeTextSimilarity(String(text), String(exampleText));
      if (score > bestScore) {
        bestScore = score;
        bestKind = kind;
        bestExampleText = exampleText;
        bestRequiresQuote = requiresQuote;
      }
    }
    if (!bestKind) {
      return undefined;
    }
    return bestScore >= USERBOT_FILTER_MATCH_THRESHOLD
      ? {
          kind: bestKind,
          score: bestScore,
          examplePreview: this.makeTextPreview(bestExampleText, 220),
          requiresQuote: bestRequiresQuote,
        }
      : undefined;
  }

  private async matchFilterKindByPatterns(
    groupName: string,
    text: string,
    hasQuotedSource: boolean,
  ): Promise<UserbotFilterPatternMatch | undefined> {
    const rows = await this.prisma.tgUserbotFilterPattern.findMany({
      where: { enabled: true },
      orderBy: [{ groupName: 'asc' }, { createdAt: 'asc' }],
      select: { groupName: true, kind: true, pattern: true, requiresQuote: true },
    });
    const target = groupName.trim().toLowerCase();
    const normalizedText = text.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const row of rows) {
      const name = typeof row.groupName === 'string' ? row.groupName.trim().toLowerCase() : '';
      const kind = row.kind as UserbotFilterKind;
      const pattern =
        typeof row.pattern === 'string'
          ? String(row.pattern).trim().toLowerCase()
          : '';
      const requiresQuote = row.requiresQuote === true;
      if (name !== target || !pattern) {
        continue;
      }
      if (kind !== 'signal' && kind !== 'close' && kind !== 'result' && kind !== 'reentry') {
        continue;
      }
      if ((kind === 'close' || kind === 'reentry') && !hasQuotedSource) {
        continue;
      }
      if (requiresQuote && !hasQuotedSource) {
        continue;
      }
      if (normalizedText.includes(pattern)) {
        return {
          kind,
          pattern,
          requiresQuote,
        };
      }
    }
    return undefined;
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
      const reentryOverrides = await this.buildTranscriptParseOverrides(params.chatId);
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
        nextStopLoss !== undefined && !this.isNumberClose(nextStopLoss, base.stopLoss);
      const hasTakeProfitsChanged =
        Array.isArray(nextTakeProfits) &&
        !this.arePriceArraysClose(nextTakeProfits, base.takeProfits);

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

  private isNumberClose(a: number, b: number): boolean {
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      return false;
    }
    const diff = Math.abs(a - b);
    const base = Math.max(Math.abs(b), 1);
    return diff / base <= 0.0005;
  }

  private arePriceArraysClose(a: number[], b: number[]): boolean {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      const av = a[i];
      const bv = b[i];
      if (av == null || bv == null || !this.isNumberClose(av, bv)) {
        return false;
      }
    }
    return true;
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

  private computeTextSimilarity(a: string, b: string): number {
    const aTokens = this.tokenizeForSimilarity(a);
    const bTokens = this.tokenizeForSimilarity(b);
    if (aTokens.size === 0 || bTokens.size === 0) {
      return 0;
    }

    let intersection = 0;
    for (const tok of aTokens) {
      if (bTokens.has(tok)) {
        intersection += 1;
      }
    }
    const union = aTokens.size + bTokens.size - intersection;
    if (union <= 0) {
      return 0;
    }
    return intersection / union;
  }

  private tokenizeForSimilarity(text: string): Set<string> {
    const normalized = text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (!normalized) {
      return new Set();
    }
    return new Set(
      normalized
        .split(/\s+/)
        .map((x) => x.trim())
        .filter((x) => x.length >= 3)
        .slice(0, 256),
    );
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

    const chatMeta = await this.prisma.tgUserbotChat.findUnique({
      where: { chatId: params.chatId },
      select: { title: true },
    });
    const notify = await this.telegramBot.notifyUserbotResultWithoutEntry({
      ingestId: params.ingestId,
      chatId: params.chatId,
      groupTitle: chatMeta?.title?.trim() || undefined,
      pair: signal.pair,
      signalId: signal.id,
      resultMessageText: params.text,
      quotedSnippet: params.quotedText,
    });
    void this.vkNotifyMirror.mirrorNotifyUserbotResultWithoutEntry({
      ingestId: params.ingestId,
      chatId: params.chatId,
      groupTitle: chatMeta?.title?.trim() || undefined,
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

  private async fetchChatMessageMeta(
    chatId: string,
    messageId: string,
  ): Promise<{ text?: string; replyToMessageId?: string; error?: string }> {
    if (!this.client || !(await this.isClientAuthorized(this.client))) {
      return { error: 'telegram_client_unavailable' };
    }
    try {
      const list = (await this.client.getMessages(chatId, {
        ids: [Number(messageId)],
        limit: 1,
      })) as unknown as Array<Record<string, unknown>>;
      const msg = list[0];
      return {
        text: this.readString(msg?.message),
        replyToMessageId: this.extractReplyToMessageId(
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

  private normalizeSourcePriority(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return 0;
    }
    return Math.max(0, Math.floor(n));
  }

  private async findActiveSignalForPairAndDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<ActiveSignalLookup | null> {
    const wantPair = normalizeTradingPair(pair);
    const rows = await this.prisma.signal.findMany({
      where: {
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
    const chatRaw = await (this.prisma as any).tgUserbotChat.findUnique({
      where: { chatId },
      select: { title: true, sourcePriority: true },
    });
    const chat = chatRaw as
      | { title?: string | null; sourcePriority?: number | null }
      | null;
    return {
      priority: this.normalizeSourcePriority(chat?.sourcePriority),
      sourceName: chat?.title?.trim() || sourceName || chatId,
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

  private extractTokenHint(text: string): string {
    const m = text.match(/\b([A-Z0-9]{2,15}USDT)\b/i);
    if (m?.[1]) {
      return m[1].toUpperCase();
    }
    const firstWord = text
      .trim()
      .split(/\s+/)[0]
      ?.replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase();
    return firstWord || 'UNKNOWN';
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

  /** U+1F510 — если в тексте больше 5 раз, не считаем сообщение торговым. */
  private countLockEmojiInText(text: string): number {
    const m = text.match(/\u{1F510}/gu);
    return m ? m.length : 0;
  }

  private makeTextPreview(text: string, max = 180): string {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized.length <= max) {
      return normalized;
    }
    return `${normalized.slice(0, max)}...`;
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
    const chatMeta = await this.prisma.tgUserbotChat.findUnique({
      where: { chatId: params.chatId },
    });
    const groupTitle = chatMeta?.title?.trim();
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
    const forcedKind =
      preferredKind &&
      (preferredKind === 'close' || preferredKind === 'reentry') &&
      !replyId
        ? undefined
        : preferredKind;
    if (forcedKind) {
      return {
        kind: forcedKind,
        aiRequest: this.limitTrace(
          JSON.stringify({
            operation: 'classifyMessage',
            source: preferredKindSource ?? 'group_filter_example',
            groupName: groupName ?? null,
            preferredKind: forcedKind,
          }),
        ),
        aiResponse: this.limitTrace(
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
          token: this.extractTokenHint(text),
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
    const aiRequest = this.limitTrace(
      ai.debug?.request ??
        JSON.stringify({
          operation: 'classifyTradingMessage',
          text,
          replyToMessageId: replyToMessageId ?? null,
          quotedText: quotedText ?? null,
        }),
    );
    const aiResponse = this.limitTrace(
      JSON.stringify({
        aiKind: ai.kind,
        aiReason: ai.reason,
        usedFallback: ai.debug?.usedFallback ?? false,
        rawResponse: ai.debug?.response,
      }),
    );
    return { kind: ai.kind, aiRequest, aiResponse };
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

  private async getBalanceGuardSnapshot(): Promise<{
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
    const now = Date.now();
    let balanceUsd: number | undefined;
    let totalBalanceUsd: number | undefined;
    if (
      this.balanceCheckCache &&
      now - this.balanceCheckCache.checkedAtMs < USERBOT_BALANCE_CHECK_CACHE_MS &&
      this.balanceCheckCache.minBalanceUsd === minBalanceUsd
    ) {
      balanceUsd = this.balanceCheckCache.balanceUsd;
      totalBalanceUsd = this.balanceCheckCache.totalBalanceUsd;
    } else {
      const details = await this.bybit.getUnifiedUsdtBalanceDetails();
      balanceUsd = details?.availableUsd;
      totalBalanceUsd = details?.totalUsd;
      this.balanceCheckCache = {
        checkedAtMs: now,
        balanceUsd,
        totalBalanceUsd,
        minBalanceUsd,
      };
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

  private async isMessageRecent(createdAt: Date): Promise<boolean> {
    const now = Date.now();
    let maxAgeMs = this.messageRecencyCache?.maxAgeMs;
    if (
      maxAgeMs == null ||
      !this.messageRecencyCache ||
      now - this.messageRecencyCache.checkedAtMs > 30_000
    ) {
      const maxAgeMinutes = await this.getNumberSetting(
        'TELEGRAM_USERBOT_MAX_MESSAGE_AGE_MINUTES',
        USERBOT_MAX_MESSAGE_AGE_MINUTES_DEFAULT,
        1,
        1440,
      );
      maxAgeMs = maxAgeMinutes * 60_000;
      this.messageRecencyCache = {
        checkedAtMs: now,
        maxAgeMs,
      };
    }
    return Date.now() - createdAt.getTime() <= maxAgeMs;
  }

  private async tryCreateIngestRow(data: {
    chatId: string;
    messageId: string;
    dedupMessageKey: string;
    text: string;
    classification: string;
    status: string;
  }) {
    try {
      return await this.prisma.tgUserbotIngest.create({ data });
    } catch (e) {
      if (this.isUniqueConstraintError(e)) {
        return null;
      }
      throw e;
    }
  }

  private async updateIngest(id: string, data: Prisma.TgUserbotIngestUpdateInput) {
    await this.prisma.tgUserbotIngest.update({
      where: { id },
      data,
    });
  }

  private isUniqueConstraintError(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    return code === 'P2002';
  }

  private async refreshEnabledChatsCache() {
    const rows = await this.prisma.tgUserbotChat.findMany({
      where: { enabled: true },
      select: { chatId: true },
    });
    this.enabledChatIds = new Set(rows.map((r) => r.chatId));
  }

  private async getApiCreds(): Promise<{ apiId: number; apiHash: string }> {
    const apiIdRaw = (await this.settings.get('TELEGRAM_USERBOT_API_ID'))?.trim();
    const apiHash = (await this.settings.get('TELEGRAM_USERBOT_API_HASH'))?.trim();
    const apiId = apiIdRaw ? parseInt(apiIdRaw, 10) : Number.NaN;
    if (!Number.isFinite(apiId) || !apiHash) {
      throw new Error(
        'Нужно заполнить TELEGRAM_USERBOT_API_ID и TELEGRAM_USERBOT_API_HASH в настройках.',
      );
    }
    return { apiId, apiHash };
  }

  private async getTelegramClientOptions(): Promise<Record<string, unknown>> {
    const options: Record<string, unknown> = { connectionRetries: 5 };
    const mtProxy = await this.getMtProxyConfig();
    if (mtProxy) {
      options.proxy = mtProxy;
    }
    return options;
  }

  private async getMtProxyConfig(): Promise<
    { ip: string; port: number; secret: string; MTProxy: true } | null
  > {
    const raw = (await this.settings.get('TELEGRAM_USERBOT_MTPROXY_URL'))?.trim();
    if (!raw) {
      return null;
    }

    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new Error(
        'Неверный TELEGRAM_USERBOT_MTPROXY_URL: ожидается ссылка вида https://t.me/proxy?server=...&port=...&secret=...',
      );
    }

    const server = url.searchParams.get('server')?.trim() ?? '';
    const secret = url.searchParams.get('secret')?.trim() ?? '';
    const portRaw = url.searchParams.get('port')?.trim() ?? '';
    const port = Number.parseInt(portRaw, 10);

    if (!server || !secret || !Number.isFinite(port) || port < 1 || port > 65535) {
      throw new Error(
        'Неверный TELEGRAM_USERBOT_MTPROXY_URL: нужны параметры server, port (1..65535) и secret.',
      );
    }

    return {
      ip: server,
      port,
      secret,
      MTProxy: true,
    };
  }

  private async isClientAuthorized(client: TelegramClient | null): Promise<boolean> {
    if (!client) {
      return false;
    }
    try {
      const res = await client.checkAuthorization();
      return res === true;
    } catch {
      return false;
    }
  }

  private toFixedPrice(value: number): string {
    return Number.isFinite(value) ? value.toFixed(4) : '0.0000';
  }

  private normalizeDirection(direction: SignalDto['direction']): 'LONG' | 'SHORT' {
    return direction === 'short' ? 'SHORT' : 'LONG';
  }

  private calculateMovePercent(params: {
    from: number;
    to: number;
    direction: 'LONG' | 'SHORT';
  }): string {
    if (!Number.isFinite(params.from) || params.from === 0 || !Number.isFinite(params.to)) {
      return '0.00%';
    }
    const raw =
      params.direction === 'LONG'
        ? ((params.to - params.from) / params.from) * 100
        : ((params.from - params.to) / params.from) * 100;
    return `${Math.abs(raw).toFixed(2)}%`;
  }

  private stripTelegramExportPrefix(text: string): string {
    const lines = text.replace(/\r/g, '').split('\n');
    if (lines.length === 0) {
      return '';
    }
    const firstLine = lines[0];
    if (firstLine === undefined) {
      return lines.join('\n').trim();
    }
    lines[0] = firstLine
      .replace(/^\[\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}\]\s*[^:]+:\s*/u, '')
      .trimStart();
    return lines.join('\n').trim();
  }

  private formatMirrorSignalText(signal: SignalDto, _sourceChatTitle?: string): string {
    void _sourceChatTitle;
    const direction = this.normalizeDirection(signal.direction);
    const pair = signal.pair.toUpperCase();
    const entries = [...signal.entries].filter(Number.isFinite).sort((a, b) => a - b);
    const tps = [...signal.takeProfits].filter(Number.isFinite);
    const entryLow = entries[0] ?? signal.entries[0] ?? 0;
    const entryHigh = entries[entries.length - 1] ?? signal.entries[0] ?? 0;
    const entryMid = (entryLow + entryHigh) / 2;
    const slPercent = this.calculateMovePercent({
      from: entryMid,
      to: signal.stopLoss,
      direction,
    });
    const targetLines = tps.map(
      (tp, idx) =>
        `${idx + 1}. ${this.toFixedPrice(tp)} (${this.calculateMovePercent({ from: entryMid, to: tp, direction })})`,
    );

    return [
      `${direction === 'LONG' ? '🟢' : '🔴'} ${direction} ${pair}`,
      '',
      '📊 Market: futures',
      `⚡ Leverage: ${signal.leverage}x`,
      '',
      '💰 Entry Range:',
      `${this.toFixedPrice(entryLow)} - ${this.toFixedPrice(entryHigh)}`,
      '',
      '🛑 Stop Loss:',
      `${this.toFixedPrice(signal.stopLoss)} (${slPercent})`,
      '',
      '🎯 Targets:',
      ...(targetLines.length > 0 ? targetLines : ['1. —']),
      '',
      '🤖 Auto-generated signal',
    ].join('\n');
  }

  private formatMirrorResultText(text: string): string {
    const cleaned = this.stripTelegramExportPrefix(text);
    return cleaned.slice(0, 3500);
  }

  private formatMirrorCancelText(text: string): string {
    const cleaned = this.stripTelegramExportPrefix(text);
    return cleaned.slice(0, 3500);
  }

  private async sendMirrorMessage(params: {
    targetChatId: string;
    text: string;
    replyToMessageId?: string;
  }): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
    if (!this.client || !(await this.isClientAuthorized(this.client))) {
      return { ok: false, error: 'Telegram userbot не авторизован' };
    }
    try {
      const sent = (await this.client.sendMessage(params.targetChatId, {
        message: params.text,
        ...(params.replyToMessageId
          ? { replyTo: Number(params.replyToMessageId) }
          : {}),
      })) as { id?: number };
      const mid = sent?.id;
      if (!Number.isFinite(mid)) {
        return { ok: false, error: 'Не удалось получить messageId отправленного сообщения' };
      }
      return { ok: true, messageId: String(mid) };
    } catch (e) {
      return { ok: false, error: formatError(e) };
    }
  }

  private async publishSignalToMirrorGroups(params: {
    ingest: { id: string; chatId: string; messageId: string };
    signal: SignalDto;
    sourceChatTitle?: string;
  }): Promise<void> {
    const prismaAny = this.prisma as any;
    const groups = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    if (groups.length === 0) return;
    for (const g of groups) {
      const existing = await prismaAny.tgUserbotMirrorMessage.findFirst({
        where: { publishGroupId: g.id, ingestId: params.ingest.id, kind: 'signal' },
        select: { id: true },
      });
      if (existing) continue;
      const { shouldPublish, nextCounter } = await this.prisma.$transaction(async (tx) => {
        const txAny = tx as any;
        const row = await txAny.tgUserbotPublishGroup.findUnique({
          where: { id: g.id },
          select: { signalCounter: true, publishEveryN: true },
        });
        const current = Number(row?.signalCounter ?? 0) || 0;
        const n = Math.max(
          1,
          Number(row?.publishEveryN ?? g.publishEveryN ?? 1) || 1,
        );
        const next = current + 1;
        await txAny.tgUserbotPublishGroup.update({
          where: { id: g.id },
          data: { signalCounter: next },
        });
        return { shouldPublish: next % n === 0, nextCounter: next };
      });
      if (!shouldPublish) {
        await prismaAny.tgUserbotMirrorMessage.create({
          data: {
            publishGroupId: g.id,
            ingestId: params.ingest.id,
            sourceChatId: params.ingest.chatId,
            sourceMessageId: params.ingest.messageId,
            kind: 'signal',
            status: 'skipped_by_n',
            targetChatId: g.chatId,
            error: `Счетчик=${nextCounter}, публикуем каждый ${g.publishEveryN}`,
          },
        });
        continue;
      }
      const out = await this.sendMirrorMessage({
        targetChatId: g.chatId,
        text: this.formatMirrorSignalText(params.signal, params.sourceChatTitle),
      });
      await prismaAny.tgUserbotMirrorMessage.create({
        data: {
          publishGroupId: g.id,
          ingestId: params.ingest.id,
          sourceChatId: params.ingest.chatId,
          sourceMessageId: params.ingest.messageId,
          kind: 'signal',
          status: out.ok ? 'posted' : 'failed',
          targetChatId: g.chatId,
          targetMessageId: out.ok ? out.messageId : null,
          error: out.ok ? null : out.error,
        },
      });
    }
  }

  private async publishOutcomeToMirrorGroups(params: {
    ingest: { id: string; chatId: string; messageId: string };
    kind: 'result' | 'cancel';
    text: string;
    rootSourceMessageId?: string;
  }): Promise<void> {
    const prismaAny = this.prisma as any;
    const groups = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { enabled: true },
      orderBy: { createdAt: 'asc' },
    });
    if (groups.length === 0) return;
    for (const g of groups) {
      const existing = await prismaAny.tgUserbotMirrorMessage.findFirst({
        where: { publishGroupId: g.id, ingestId: params.ingest.id, kind: params.kind },
        select: { id: true },
      });
      if (existing) continue;
      if (!params.rootSourceMessageId) {
        await prismaAny.tgUserbotMirrorMessage.create({
          data: {
            publishGroupId: g.id,
            ingestId: params.ingest.id,
            sourceChatId: params.ingest.chatId,
            sourceMessageId: params.ingest.messageId,
            kind: params.kind,
            status: 'skipped_no_root',
            targetChatId: g.chatId,
            error: 'Не найден root source message',
          },
        });
        continue;
      }
      const rootPosted = await prismaAny.tgUserbotMirrorMessage.findFirst({
        where: {
          publishGroupId: g.id,
          kind: 'signal',
          sourceChatId: params.ingest.chatId,
          sourceMessageId: params.rootSourceMessageId,
          status: 'posted',
          targetMessageId: { not: null },
        },
        select: { targetMessageId: true },
      });
      if (!rootPosted?.targetMessageId) {
        await prismaAny.tgUserbotMirrorMessage.create({
          data: {
            publishGroupId: g.id,
            ingestId: params.ingest.id,
            sourceChatId: params.ingest.chatId,
            sourceMessageId: params.ingest.messageId,
            rootSourceChatId: params.ingest.chatId,
            rootSourceMessageId: params.rootSourceMessageId,
            kind: params.kind,
            status: 'skipped_no_root',
            targetChatId: g.chatId,
            error: 'Связанный сигнал не был опубликован из-за фильтра N или ошибки',
          },
        });
        continue;
      }
      const out = await this.sendMirrorMessage({
        targetChatId: g.chatId,
        text:
          params.kind === 'result'
            ? this.formatMirrorResultText(params.text)
            : this.formatMirrorCancelText(params.text),
        replyToMessageId: rootPosted.targetMessageId,
      });
      await prismaAny.tgUserbotMirrorMessage.create({
        data: {
          publishGroupId: g.id,
          ingestId: params.ingest.id,
          sourceChatId: params.ingest.chatId,
          sourceMessageId: params.ingest.messageId,
          rootSourceChatId: params.ingest.chatId,
          rootSourceMessageId: params.rootSourceMessageId,
          kind: params.kind,
          status: out.ok ? 'posted' : 'failed',
          targetChatId: g.chatId,
          targetMessageId: out.ok ? out.messageId : null,
          replyToTargetMessageId: rootPosted.targetMessageId,
          error: out.ok ? null : out.error,
        },
      });
    }
  }

  private async stopQrClient(): Promise<void> {
    if (!this.qrClient) {
      return;
    }
    try {
      await this.qrClient.disconnect();
    } finally {
      this.qrClient = null;
    }
  }

  private setQrState(next: Partial<QrState>) {
    const now = new Date().toISOString();
    this.qrState = {
      ...this.qrState,
      ...next,
      startedAt: this.qrState.startedAt ?? now,
      updatedAt: now,
    };
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

  private readString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const t = value.trim();
    return t.length > 0 ? t : undefined;
  }

  private readNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'bigint') {
      return Number(value);
    }
    if (typeof value === 'string' && value.trim() !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    return undefined;
  }

  private readNumericString(value: unknown): string | undefined {
    if (value == null) {
      return undefined;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(Math.trunc(value));
    }
    if (typeof value === 'bigint') {
      return value.toString();
    }
    if (typeof value === 'string') {
      const t = value.trim();
      if (/^-?\d+$/.test(t)) {
        return t;
      }
      return undefined;
    }
    if (typeof value === 'object') {
      const maybeObj = value as Record<string, unknown>;
      const nestedValue = maybeObj.value ?? maybeObj.low;
      if (nestedValue !== undefined) {
        const nested = this.readNumericString(nestedValue);
        if (nested) {
          return nested;
        }
      }
      const asString = String(value).trim();
      if (/^-?\d+$/.test(asString)) {
        return asString;
      }
    }
    return undefined;
  }

  private extractReplyToMessageId(value: unknown): string | undefined {
    if (value == null) {
      return undefined;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      return (
        this.readNumericString(obj.replyToMsgId ?? obj.reply_to_msg_id) ??
        this.readNumericString(obj.replyToTopId ?? obj.reply_to_top_id) ??
        this.readNumericString(obj.msgId ?? obj.msg_id) ??
        this.readNumericString(obj.id)
      );
    }
    return this.readNumericString(value);
  }

  private extractSignalExternalId(text: unknown): string | undefined {
    const raw = typeof text === 'string' ? text : '';
    if (!raw) {
      return undefined;
    }
    const normalized = raw.replace(/\u00a0/g, ' ');
    const match = normalized.match(
      /(?:^|[^\p{L}\p{N}_])signal\s*id\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9._/-]{0,127})/iu,
    );
    return match?.[1]?.trim();
  }

  private readBooleanish(value: unknown): boolean {
    return value === true || value === 1 || value === 'true';
  }

  private extractMessageDate(value: unknown): Date | undefined {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      const ms = value > 1e12 ? value : value * 1000;
      const dt = new Date(ms);
      return Number.isFinite(dt.getTime()) ? dt : undefined;
    }
    if (typeof value === 'bigint') {
      const n = Number(value);
      if (Number.isFinite(n)) {
        return this.extractMessageDate(n);
      }
      return undefined;
    }
    if (typeof value === 'string' && value.trim() !== '') {
      if (/^\d+$/.test(value.trim())) {
        return this.extractMessageDate(Number(value.trim()));
      }
      const dt = new Date(value);
      return Number.isFinite(dt.getTime()) ? dt : undefined;
    }
    return undefined;
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private isToday(d: Date): boolean {
    return d.getTime() >= this.startOfToday().getTime();
  }

  private resolveChatIdFromDialog(dialog: Record<string, unknown>): string | undefined {
    const entity = (dialog.entity ?? {}) as Record<string, unknown>;
    const className = this.readString(entity.className)?.toLowerCase();
    const fromInput = (dialog.inputEntity ?? {}) as Record<string, unknown>;

    const channelId =
      this.readNumericString(fromInput.channelId ?? fromInput.channel_id) ??
      this.readNumericString(entity.id);
    if (
      channelId &&
      (this.readBooleanish(dialog.isChannel) || className === 'channel')
    ) {
      return this.toChannelChatId(channelId);
    }

    const chatId =
      this.readNumericString(fromInput.chatId ?? fromInput.chat_id) ??
      this.readNumericString(entity.id);
    if (chatId && className === 'chat') {
      return this.toLegacyGroupChatId(chatId);
    }

    const genericId =
      this.readNumericString(dialog.id) ??
      this.readNumericString(entity.id) ??
      this.readNumericString(fromInput.channelId ?? fromInput.channel_id) ??
      this.readNumericString(fromInput.chatId ?? fromInput.chat_id);
    if (!genericId) {
      return undefined;
    }
    if (genericId.startsWith('-100') || genericId.startsWith('-')) {
      return genericId;
    }
    return this.toChannelChatId(genericId);
  }

  private resolveChatIdFromEvent(
    event: Record<string, unknown>,
    msg: Record<string, unknown> | undefined,
  ): string | undefined {
    const fromEvent = this.readNumericString(event.chatId ?? event.chat_id);
    if (fromEvent) {
      return fromEvent;
    }
    const peerId = (msg?.peerId ?? msg?.peer) as Record<string, unknown> | undefined;
    const channelId = this.readNumericString(
      peerId?.channelId ?? peerId?.channel_id,
    );
    if (channelId != null) {
      return this.toChannelChatId(channelId);
    }
    const chatId = this.readNumericString(peerId?.chatId ?? peerId?.chat_id);
    if (chatId != null) {
      return this.toLegacyGroupChatId(chatId);
    }
    const userId = this.readNumericString(peerId?.userId ?? peerId?.user_id);
    if (userId != null) {
      return userId;
    }
    return undefined;
  }

  private toChannelChatId(raw: string): string {
    const digits = raw.replace(/^-100/, '').replace(/^-/, '');
    return `-100${digits}`;
  }

  private toLegacyGroupChatId(raw: string): string {
    const digits = raw.replace(/^-/, '');
    return `-${digits}`;
  }

  private limitTrace(value: string, max = 7000): string {
    if (value.length <= max) {
      return value;
    }
    return `${value.slice(0, max)} ...[truncated ${value.length - max} chars]`;
  }
}
