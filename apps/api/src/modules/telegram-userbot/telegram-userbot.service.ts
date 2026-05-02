import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeTradingPair, type SignalDto } from '@repo/shared';
import { TelegramClient } from 'telegram';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';
import { SettingsService } from '../settings/settings.service';
/** До Bybit/Orders/Telegram: иначе orders → telegram раньше transcript. */
import {
  TranscriptService,
} from '../transcript/transcript.service';
import { BybitService } from '../bybit/bybit.service';
import { OrdersService } from '../orders/orders.service';
import { TelegramService } from '../telegram/telegram.service';
import { VkNotifyMirrorService } from '../vk/vk-notify-mirror.service';
import { UserbotSignalHashService } from './userbot-signal-hash.service';
import { parseSignalPriceArrayJson } from './userbot-signal-hash.util';
import {
  CLOSE_REOPEN_COOLDOWN_MS,
  CRITICAL_NOTIFY_URL,
  USERBOT_INLINE_TEXT_MAX_CHARS,
  USERBOT_MIN_BALANCE_USD_DEFAULT,
  USERBOT_POLL_INTERVAL_MS,
  USERBOT_SIGNAL_LEVELS_EDIT_WATCH_POLL_MS,
  USERBOT_SIGNAL_LEVELS_EDIT_WATCH_TTL_MS,
} from './telegram-userbot.constants';
import type {
  ActiveSignalLookup,
  MessageKind,
  OpenrouterSpendPeriod,
  QrState,
  ScopedChatOverride,
  UserbotFilterKind,
} from './telegram-userbot.types';
import { TelegramUserbotFiltersService } from './filters/telegram-userbot-filters.service';
import { TelegramUserbotClientService } from './client/telegram-userbot-client.service';
import { TelegramUserbotIngestService } from './ingest/telegram-userbot-ingest.service';
import { TelegramUserbotIngestPipelineService } from './ingest/telegram-userbot-ingest-pipeline.service';
import { TelegramUserbotMirrorService } from './mirror/telegram-userbot-mirror.service';
import { TelegramUserbotPollingService } from './polling/telegram-userbot-polling.service';
import { TelegramUserbotScanService } from './scan/telegram-userbot-scan.service';
import { TelegramUserbotSettingsService } from './settings/telegram-userbot-settings.service';
import { TelegramUserbotOpenrouterService } from './openrouter/telegram-userbot-openrouter.service';
import { arePriceArraysClose, isNumberClose } from './utils/telegram-userbot-text-similarity.util';
import { extractTokenHint, makeTextPreview } from './utils/telegram-userbot-text.util';
import {
  extractMessageDate,
  extractReplyToMessageId,
  extractSignalExternalId,
  isToday,
  limitTrace,
  readBooleanish,
  readNumber,
  readNumericString,
  readString,
  resolveChatIdFromDialog,
  resolveChatIdFromEvent,
  startOfToday,
  toChannelChatId,
  toLegacyGroupChatId,
} from './utils/telegram-userbot-parse.util';

@Injectable()
export class TelegramUserbotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramUserbotService.name);
  private enabledChatIds = new Set<string>();
  private reconnectInFlight = false;
  private lastReconnectAttemptAtMs = 0;

  private async getCurrentOwnerUserId(): Promise<string | null> {
    return this.userbotClient.getOwnerUserId();
  }

  private async isClientOwnedByCurrentUser(): Promise<boolean> {
    return this.userbotClient.isClientOwnedByCurrentUser();
  }

  private async getCurrentUserClient(): Promise<TelegramClient | null> {
    return this.userbotClient.getCurrentUserClient();
  }

  private getQrStateForUser(userId: string | null): QrState {
    return this.userbotClient.getQrStateForUser(userId);
  }

  private setQrStateForUser(userId: string | null, next: Partial<QrState>) {
    this.userbotClient.setQrStateForUser(userId, next);
  }

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
    private readonly openrouter: TelegramUserbotOpenrouterService,
    private readonly userbotClient: TelegramUserbotClientService,
    private readonly ingest: TelegramUserbotIngestService,
    private readonly userbotPipeline: TelegramUserbotIngestPipelineService,
    private readonly polling: TelegramUserbotPollingService,
    private readonly userbotScan: TelegramUserbotScanService,
    private readonly userbotSettings: TelegramUserbotSettingsService,
    private readonly userbotFilters: TelegramUserbotFiltersService,
    private readonly userbotMirror: TelegramUserbotMirrorService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.userbotClient.setInboundHandler((e) => this.handleIncomingMessage(e));
    this.userbotClient.setAfterAttachHook(() => this.refreshEnabledChatsCache());
    this.ingest.setProcessIngestRecord((ingest, text, meta, opts) =>
      this.userbotPipeline.processIngestRecord(ingest, text, meta, opts),
    );
    this.userbotSettings.setEnabledChatsRefreshCallback(() => this.refreshEnabledChatsCache());
    await this.refreshEnabledChatsCache();
    void this.startPollingLoop();
    // В multi-user режиме автоподключение на старте небезопасно:
    // нет пользовательского контекста, поэтому подключение должно инициироваться из HTTP-запроса конкретного пользователя.
  }

  async onModuleDestroy(): Promise<void> {
    this.userbotPipeline.clearAllSignalLevelsValidationWatches();
    this.stopPollingLoop();
    await this.userbotClient.disconnectAll();
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
    const cabinetId = this.cabinetContext.getCabinetId() ?? undefined;
    const [chatsTotal, chatsEnabled, sameUserClient, currentOwnerUserId] = await Promise.all([
      this.prisma.tgUserbotChat.count({
        where: cabinetId
          ? {
              cabinetSources: {
                some: { cabinetId },
              },
            }
          : undefined,
      }),
      this.prisma.cabinetTelegramSource.count({
        where: {
          cabinetId,
          enabled: true,
        },
      }),
      this.isClientOwnedByCurrentUser(),
      this.getCurrentOwnerUserId(),
    ]);
    const qr = this.getQrStateForUser(currentOwnerUserId);
    const client = await this.getCurrentUserClient();
    return {
      connected: sameUserClient && (await this.isClientAuthorized(client)),
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
      pollingInFlight: this.userbotScan.getPollInFlight(),
      processingQueueDepth: this.ingest.getQueueDepth(),
      processingWorkersActive: this.ingest.getWorkersActive(),
      qr,
      balanceGuard: await this.userbotPipeline.getBalanceGuardSnapshot(),
    };
  }

  async getTodayMetrics() {
    return this.userbotScan.getTodayMetrics();
  }

  async connectFromStoredSession() {
    return this.userbotClient.connectFromStoredSession();
  }

  async disconnect() {
    return this.userbotClient.disconnect();
  }

  async startQrLogin() {
    return this.userbotClient.startQrLogin();
  }

  async getQrStatus() {
    return this.userbotClient.getQrStatus();
  }

  async cancelQrLogin() {
    return this.userbotClient.cancelQrLogin();
  }

  async syncChats() {
    const cabinetId = this.cabinetContext.getCabinetId();
    if (!cabinetId) {
      return { ok: false, error: 'Кабинет не выбран.' };
    }
    if (
      !(await this.isClientOwnedByCurrentUser())
    ) {
      return { ok: false, error: 'Userbot не подключен.' };
    }
    const client = await this.getCurrentUserClient();
    if (!client || !(await this.isClientAuthorized(client))) {
      return { ok: false, error: 'Userbot не подключен.' };
    }
    const dialogs = (await client.getDialogs({
      limit: 1000,
    })) as unknown as Array<Record<string, unknown>>;
    let upserted = 0;

    for (const d of dialogs) {
      const entity = (d.entity ?? {}) as Record<string, unknown>;
      const className = readString(entity.className)?.toLowerCase();
      const isGroupLike =
        readBooleanish(d.isGroup) ||
        readBooleanish(d.isChannel) ||
        className === 'chat' ||
        className === 'channel';
      if (!isGroupLike) {
        continue;
      }

      const chatId = resolveChatIdFromDialog(d);
      const title =
        readString(d.title) ??
        readString(d.name) ??
        readString(entity.name) ??
        readString((d.entity as Record<string, unknown> | undefined)?.title) ??
        null;
      if (!chatId || !title) {
        continue;
      }
      const username = readString(
        (d.entity as Record<string, unknown> | undefined)?.username,
      );
      await this.prisma.tgUserbotChat.upsert({
        where: { chatId },
        create: { chatId, title, username, enabled: false },
        update: { title, username },
      });
      await this.prisma.cabinetTelegramSource.upsert({
        where: { cabinetId_chatId: { cabinetId, chatId } },
        create: { cabinetId, chatId, enabled: false },
        update: {},
      });
      upserted += 1;
    }

    await this.refreshEnabledChatsCache();
    return { ok: true, upserted };
  }

  async listChats() {
    const cabinetId = this.cabinetContext.getCabinetId();
    const [rows, scopedRowsRaw, bySource, tpSlBySource, tpSlRangeBySource, openrouterSpendTodayByChatId] =
      await Promise.all([
        this.prisma.tgUserbotChat.findMany({
          where: cabinetId
            ? {
                cabinetSources: {
                  some: { cabinetId },
                },
              }
            : undefined,
          orderBy: [{ title: 'asc' }],
        }),
        cabinetId
          ? this.prisma.cabinetTelegramSource.findMany({
              where: { cabinetId },
              select: {
                chatId: true,
                enabled: true,
                sourcePriority: true,
                defaultLeverage: true,
                forcedLeverage: true,
                leverageRangeMode: true,
                minLeverage: true,
                maxLeverage: true,
                defaultEntryUsd: true,
                minLotBump: true,
                martingaleMultiplier: true,
                tpSlStepStart: true,
                tpSlStepRange: true,
              },
            })
          : Promise.resolve([]),
        this.userbotSettings.getSourceMartingaleMap(),
        this.userbotSettings.getSourceTpSlStepMap(),
        this.userbotSettings.getSourceTpSlStepRangeMap(),
        this.openrouter.getTodayOpenRouterSpendByChatId(),
      ]);
    const scopedRows = scopedRowsRaw as ScopedChatOverride[];
    const scopedByChatId = new Map<string, ScopedChatOverride>(
      scopedRows.map((row) => [row.chatId, row] as [string, ScopedChatOverride]),
    );
    return rows
      .map((row) => {
        const scoped = scopedByChatId.get(row.chatId);
        const sourceKey = row.title.trim().toLowerCase();
        return {
          ...row,
          enabled: scoped?.enabled ?? row.enabled,
          sourcePriority: this.userbotSettings.normalizeSourcePriority(
            (scoped?.sourcePriority ?? row.sourcePriority) as number | undefined,
          ),
          defaultLeverage: scoped?.defaultLeverage ?? row.defaultLeverage,
          forcedLeverage: scoped?.forcedLeverage ?? row.forcedLeverage,
          leverageRangeMode: scoped?.leverageRangeMode ?? row.leverageRangeMode,
          minLeverage: scoped?.minLeverage ?? row.minLeverage,
          maxLeverage: scoped?.maxLeverage ?? row.maxLeverage,
          defaultEntryUsd: scoped?.defaultEntryUsd ?? row.defaultEntryUsd,
          minLotBump: scoped?.minLotBump ?? row.minLotBump,
          martingaleMultiplier:
            scoped?.martingaleMultiplier ??
            bySource[sourceKey] ??
            null,
          tpSlStepStart:
            scoped?.tpSlStepStart ??
            tpSlBySource[sourceKey] ??
            null,
          tpSlStepRange:
            scoped?.tpSlStepRange ??
            tpSlRangeBySource[sourceKey] ??
            null,
          openrouterCostTodayUsd: openrouterSpendTodayByChatId[row.chatId] ?? 0,
        };
      })
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.title.localeCompare(b.title, 'ru'));
  }

  async getOpenrouterSpendAnalytics(period: OpenrouterSpendPeriod = 'day') {
    return this.openrouter.getOpenrouterSpendAnalytics(period);
  }

  async getOpenrouterBalance() {
    return this.openrouter.getOpenrouterBalance();
  }

  async listPublishGroups() {
    return this.userbotMirror.listPublishGroups();
  }

  async createOrUpdatePublishGroup(body: {
    id?: string;
    title?: string;
    chatId?: string;
    enabled?: boolean;
    publishEveryN?: number;
  }) {
    return this.userbotMirror.createOrUpdatePublishGroup(body);
  }

  async deletePublishGroup(id: string) {
    return this.userbotMirror.deletePublishGroup(id);
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
    return this.userbotFilters.listFilterGroups();
  }

  async listFilterExamples() {
    return this.userbotFilters.listFilterExamples();
  }

  async listFilterPatterns() {
    return this.userbotFilters.listFilterPatterns();
  }

  async createFilterExample(body: {
    groupName?: string;
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
    example?: string;
    requiresQuote?: boolean;
  }) {
    return this.userbotFilters.createFilterExample(body);
  }

  async deleteFilterExample(id: string) {
    return this.userbotFilters.deleteFilterExample(id);
  }

  async createFilterPattern(body: {
    groupName?: string;
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
    pattern?: string;
    requiresQuote?: boolean;
  }) {
    return this.userbotFilters.createFilterPattern(body);
  }

  async deleteFilterPattern(id: string) {
    return this.userbotFilters.deleteFilterPattern(id);
  }

  async generateFilterPatterns(body: {
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ignore';
    example?: string;
  }) {
    return this.userbotFilters.generateFilterPatterns(body);
  }

  async scanTodayMessages(limitPerChatRaw?: number) {
    return this.userbotScan.scanTodayMessagesCore(limitPerChatRaw, true);
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
    const fresh = await this.userbotPipeline.fetchChatMessageMeta(ingest.chatId, ingest.messageId);
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
      const fresh = await this.userbotPipeline.fetchChatMessageMeta(row.chatId, row.messageId);
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

  private async startPollingLoop() {
    await this.polling.startLoop({
      getPollIntervalMs: () => this.getUserbotPollIntervalMs(),
      pollTick: () =>
        this.userbotScan.pollTick(
          () =>
            this.enabledChatIds.size === 0 ||
            this.userbotClient.getConnectedClientsCount() === 0,
        ),
    });
  }

  private stopPollingLoop() {
    this.polling.stopLoop();
  }

  private async getUserbotPollIntervalMs(): Promise<number> {
    return this.getNumberSetting(
      'TELEGRAM_USERBOT_POLL_INTERVAL_MS',
      USERBOT_POLL_INTERVAL_MS,
      500,
      60_000,
    );
  }

  private async tryReconnectFromStoredSession(): Promise<void> {
    if (this.reconnectInFlight) {
      return;
    }
    const now = Date.now();
    // Не долбим Telegram/API слишком часто.
    if (now - this.lastReconnectAttemptAtMs < 30_000) {
      return;
    }
    this.lastReconnectAttemptAtMs = now;
    this.reconnectInFlight = true;
    try {
      const res = await this.connectFromStoredSession();
      if (!res.ok) {
        this.logger.warn(`Userbot auto-reconnect skipped: ${res.error ?? 'unknown error'}`);
      } else {
        this.logger.log('Userbot auto-reconnect: connected from stored session');
      }
    } catch (e) {
      this.logger.warn(`Userbot auto-reconnect failed: ${formatError(e)}`);
    } finally {
      this.reconnectInFlight = false;
    }
  }

  async updateChat(
    chatId: string,
    body: {
      enabled?: boolean;
      defaultLeverage?: number | null;
      /** Принудительное плечо (всегда); null = выкл. */
      forcedLeverage?: number | null;
      /** Режим выбора плеча из диапазона: null = наследовать глобальный */
      leverageRangeMode?: 'min' | 'max' | 'mid' | null;
      /** Минимально допустимое плечо: null = наследовать глобальный */
      minLeverage?: number | null;
      /** Максимально допустимое плечо: null = наследовать глобальный */
      maxLeverage?: number | null;
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
    return this.userbotSettings.updateChat(chatId, body);
  }

  private readonly handleIncomingMessage = async (event: unknown) => {
    try {
      const rawEvent = event as Record<string, unknown>;
      const msg = rawEvent.message as Record<string, unknown> | undefined;
      const messageId = readNumber(msg?.id);
      const chatId = resolveChatIdFromEvent(rawEvent, msg);
      const text = readString(msg?.message);
      const replyToMessageId = extractReplyToMessageId(
        msg?.replyTo ?? msg?.reply_to ?? msg?.replyToMsgId ?? msg?.reply_to_msg_id,
      );
      const createdAt = extractMessageDate(msg?.date);
      if (!chatId || messageId == null || !text?.trim() || !createdAt) {
        return;
      }
      if (!isToday(createdAt)) {
        return;
      }
      if (!(await this.userbotScan.isMessageRecent(createdAt))) {
        return;
      }
      if (!this.enabledChatIds.has(chatId)) {
        return;
      }
      this.userbotScan.noteLastSeenMessageId(chatId, messageId);
      await this.ingest.ingestChatMessage(
        chatId,
        String(messageId),
        text.trim(),
        {
          replyToMessageId,
          signalExternalId: extractSignalExternalId(text),
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

  private async refreshEnabledChatsCache() {
    const [scopedRows, legacyRows] = await Promise.all([
      this.prisma.cabinetTelegramSource.findMany({
        where: { enabled: true },
        select: { chatId: true },
      }),
      this.prisma.tgUserbotChat.findMany({
        where: { enabled: true },
        select: { chatId: true },
      }),
    ]);
    this.enabledChatIds = new Set([
      ...scopedRows.map((r) => r.chatId),
      ...legacyRows.map((r) => r.chatId),
    ]);
  }

  private async isClientAuthorized(client: TelegramClient | null): Promise<boolean> {
    return this.userbotClient.isClientAuthorized(client);
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
