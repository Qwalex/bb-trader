import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { shouldRunUserbotMtproto } from '../../config/process-role.util';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { normalizeTradingPair, type SignalDto } from '@repo/shared';
import { TelegramClient } from 'telegram';

import { postCriticalNotifyText } from '../../common/critical-notify.util';
import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { SettingsService } from '../settings/settings.service';
import { TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY } from '../settings/settings.constants';
/** До Bybit/Orders/Telegram: иначе orders → telegram раньше transcript. */
import {
  TranscriptService,
} from '../transcript/transcript.service';
import { BybitService } from '../bybit/bybit.service';
import { OrdersService } from '../orders/orders.service';
import { TelegramService } from '../telegram/services/telegram.service';
import { VkNotifyMirrorService } from '../vk/vk-notify-mirror.service';
import { UserbotSignalHashService } from './userbot-signal-hash.service';
import { parseSignalPriceArrayJson } from './userbot-signal-hash.util';
import {
  CLOSE_REOPEN_COOLDOWN_MS,
  USERBOT_INGEST_EDIT_REQUEUE_STATUSES,
  USERBOT_MIN_BALANCE_USD_DEFAULT,
  USERBOT_POLL_INTERVAL_MS,
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
import { ContentGenerationPresetService } from './content-editor/content-generation-preset.service';
import { TelegramUserbotContentEditorService } from './content-editor/telegram-userbot-content-editor.service';
import { QpulseSyncService } from '../qpulse-sync/qpulse-sync.service';
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
  private restoreWatchdogTimer: NodeJS.Timeout | null = null;
  private restoreWatchdogInFlight = false;

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
    private readonly cabinetContext: CabinetContextService,
    private readonly transcript: TranscriptService,
    private readonly bybit: BybitService,
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    @Inject(forwardRef(() => TelegramService))
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
    private readonly contentEditor: TelegramUserbotContentEditorService,
    private readonly contentPresets: ContentGenerationPresetService,
    private readonly qpulseSync: QpulseSyncService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!shouldRunUserbotMtproto()) {
      this.logger.log('Userbot MTProto skipped for current API_PROCESS_ROLE');
      return;
    }
    this.userbotClient.setInboundHandler((e) => this.handleIncomingMessage(e));
    this.userbotClient.setAfterAttachHook(() => this.onAfterUserbotAttach());
    this.ingest.setProcessIngestRecord((ingest, text, meta, opts) =>
      this.userbotPipeline.processIngestRecord(ingest, text, meta, opts),
    );
    this.userbotSettings.setEnabledChatsRefreshCallback(() => this.refreshEnabledChatsCache());
    await this.refreshEnabledChatsCache();
    await this.tryRestoreUserbotOnStartup().catch((e) => {
      this.logger.warn(`Userbot startup restore failed: ${formatError(e)}`);
    });
    this.startRestoreWatchdog();
    void this.startPollingLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.userbotPipeline.clearAllEditWatches();
    this.stopPollingLoop();
    this.stopRestoreWatchdog();
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

  async submitQrPassword(password: string) {
    return this.userbotClient.submitQrPassword(password);
  }

  /** Включённые источники (группы/каналы) для текущего кабинета — для дашборда. */
  async listEnabledConnectedGroups(): Promise<{
    items: { chatId: string; title: string; username: string | null }[];
  }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    if (!cabinetId) {
      return { items: [] };
    }
    const rows = await this.prisma.cabinetTelegramSource.findMany({
      where: { cabinetId, enabled: true },
      orderBy: { chatId: 'asc' },
      select: {
        chatId: true,
        chat: { select: { title: true, username: true } },
      },
    });
    return {
      items: rows.map((r) => ({
        chatId: r.chatId,
        title: (r.chat?.title ?? '').trim() || r.chatId,
        username: r.chat?.username?.trim() ? r.chat.username.trim() : null,
      })),
    };
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
    let dialogs: Array<Record<string, unknown>>;
    try {
      dialogs = (await client.getDialogs({
        limit: 1000,
      })) as unknown as Array<Record<string, unknown>>;
    } catch (e) {
      const msg = formatError(e);
      this.logger.warn(`Userbot syncChats: getDialogs failed: ${msg}`);
      if (/CHANNEL_INVALID/i.test(msg)) {
        return {
          ok: false,
          error:
            'Telegram вернул CHANNEL_INVALID при загрузке диалогов: в аккаунте есть ссылка на недоступный канал/чат. Уберите такие источники в настройках или отключите лишние чаты; при необходимости переподключите userbot.',
        };
      }
      return {
        ok: false,
        error: `Не удалось загрузить список чатов: ${msg}`,
      };
    }
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
    linkedToApp?: boolean;
  }) {
    return this.userbotMirror.createOrUpdatePublishGroup(body);
  }

  async getQpulseSettings() {
    return this.qpulseSync.getPublicConfig();
  }

  async saveQpulseSettings(body: {
    enabled?: boolean;
    apiUrl?: string;
    apiKey?: string;
  }) {
    return this.qpulseSync.saveConfig(body);
  }

  async deletePublishGroup(id: string) {
    return this.userbotMirror.deletePublishGroup(id);
  }

  async listContentPosts(options?: {
    status?: string;
    classification?: string | string[];
    sourceChatId?: string;
    q?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  }) {
    return this.contentEditor.listPosts(options);
  }

  async getContentCollectSettings() {
    return this.contentEditor.getCollectSettings();
  }

  async saveContentCollectSettings(body: { kinds?: string[] }) {
    return this.contentEditor.saveCollectSettings(body);
  }

  async listContentPresets() {
    return this.contentPresets.listPresets();
  }

  async createContentPreset(body: Parameters<ContentGenerationPresetService['createPreset']>[0]) {
    return this.contentPresets.createPreset(body);
  }

  async updateContentPreset(
    id: string,
    body: Parameters<ContentGenerationPresetService['updatePreset']>[1],
  ) {
    return this.contentPresets.updatePreset(id, body);
  }

  async deleteContentPreset(id: string) {
    return this.contentPresets.deletePreset(id);
  }

  async listContentPresetRuns(presetId: string, limit?: number) {
    return this.contentPresets.listRuns(presetId, limit);
  }

  async runContentPreset(
    presetId: string,
    options?: { postIds?: string[]; force?: boolean },
  ) {
    return this.contentPresets.runPreset(presetId, options);
  }

  async generateContent(body: {
    presetId?: string;
    postIds?: string[];
    instruction?: string;
    outputKind?: string;
  }) {
    const postIds = (body.postIds ?? []).map((id) => String(id).trim()).filter(Boolean);
    if (body.presetId?.trim()) {
      return this.contentPresets.runPreset(body.presetId.trim(), {
        postIds: postIds.length > 0 ? postIds : undefined,
        force: true,
      });
    }
    if (postIds.length === 0) {
      return { ok: false as const, error: 'Укажите presetId или postIds' };
    }
    const posts: Array<{ classification: string; text: string; id: string; sourceChatId: string; sourceMessageId: string }> = [];
    for (const id of postIds) {
      const row = await this.contentEditor.getPost(id);
      if (!row.ok) return { ok: false as const, error: row.error };
      posts.push({
        id: row.item.id,
        classification: row.item.classification,
        text: row.item.displayText,
        sourceChatId: row.item.sourceChatId,
        sourceMessageId: row.item.sourceMessageId,
      });
    }
    const outputKind = body.outputKind?.trim() || posts[0]!.classification;
    const generated = await this.transcript.generateChannelContent({
      outputKind,
      instruction: body.instruction,
      sources: posts.map((p) => ({ classification: p.classification, text: p.text })),
      openrouterLogContext: { stage: 'content_generation_manual' },
    });
    if (!generated.ok || !generated.text) {
      return { ok: false as const, error: generated.error ?? 'AI generation failed' };
    }
    const created = await this.contentEditor.createGeneratedDraft({
      text: generated.text,
      classification: outputKind as 'analysis' | 'content' | 'news' | 'other',
      sourcePosts: posts,
    });
    if (!created.ok) return { ok: false as const, error: created.error };
    const item = await this.contentEditor.getPost(created.postId);
    if (!item.ok) return { ok: false as const, error: item.error };
    return { ok: true as const, postId: created.postId, item: item.item };
  }

  async getContentPost(id: string) {
    return this.contentEditor.getPost(id);
  }

  async updateContentPost(id: string, body: { editedText?: string | null }) {
    return this.contentEditor.updatePost(id, body);
  }

  async aiRewriteContentPost(id: string, body: { instruction?: string }) {
    return this.contentEditor.aiRewritePost(id, body);
  }

  async publishContentPost(id: string, targetGroupIds?: string[]) {
    return this.contentEditor.publishPost(id, targetGroupIds);
  }

  async deleteContentPost(id: string) {
    return this.contentEditor.deletePost(id);
  }

  async saveContentPublishGroups(body: { enabledGroupIds?: string[] }) {
    return this.contentEditor.saveContentPublishGroups(body);
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
    return this.userbotPipeline.listIngestLinkCandidates(options);
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
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ad' | 'analysis' | 'promo' | 'content' | 'news' | 'ignore';
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
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ad' | 'analysis' | 'promo' | 'content' | 'news' | 'ignore';
    pattern?: string;
    requiresQuote?: boolean;
  }) {
    return this.userbotFilters.createFilterPattern(body);
  }

  async deleteFilterPattern(id: string) {
    return this.userbotFilters.deleteFilterPattern(id);
  }

  async generateFilterPatterns(body: {
    kind?: 'signal' | 'close' | 'result' | 'reentry' | 'ad' | 'analysis' | 'promo' | 'content' | 'news' | 'ignore';
    example?: string;
  }) {
    return this.userbotFilters.generateFilterPatterns(body);
  }

  async scanTodayMessages(limitPerChatRaw?: number) {
    return this.userbotScan.scanTodayMessagesCore(limitPerChatRaw, true);
  }

  async rereadIngestMessage(ingestId: string) {
    return this.userbotPipeline.rereadIngestMessage(ingestId);
  }

  async rereadAllIngestMessages(limitRaw?: number) {
    return this.userbotPipeline.rereadAllIngestMessages(limitRaw);
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

  /**
   * После деплоя процесс новый, MTProto клиент в памяти пуст.
   * Даже если restore при старте не успел/упал (сеть/Telegram), нужно догнать подключение позже.
   */
  private startRestoreWatchdog(): void {
    if (this.restoreWatchdogTimer) return;
    this.restoreWatchdogTimer = setInterval(() => {
      if (this.restoreWatchdogInFlight) return;
      this.restoreWatchdogInFlight = true;
      void this.tryRestoreUserbotWatchdogTick()
        .catch((e) => {
          this.logger.debug(`Userbot restore watchdog tick failed: ${formatError(e)}`);
        })
        .finally(() => {
          this.restoreWatchdogInFlight = false;
        });
    }, 30_000);
  }

  private stopRestoreWatchdog(): void {
    if (!this.restoreWatchdogTimer) return;
    clearInterval(this.restoreWatchdogTimer);
    this.restoreWatchdogTimer = null;
  }

  private async tryRestoreUserbotWatchdogTick(): Promise<void> {
    const [enabled, session] = await Promise.all([
      this.getBoolSetting('TELEGRAM_USERBOT_ENABLED', false),
      this.settings.get('TELEGRAM_USERBOT_SESSION'),
    ]);
    if (!enabled || !session?.trim()) {
      return;
    }
    const ownerId = await this.resolveSessionOwnerUserIdForRestore();
    if (!ownerId) return;
    if (this.userbotClient.isAuthKeyDuplicateBackoffActive()) {
      return;
    }
    const client = this.userbotClient.getClientForOwnerUserId(ownerId);
    const connectedNow = Boolean(client && (await this.userbotClient.isClientAuthorized(client)));
    if (connectedNow) {
      return;
    }
    const res = await this.userbotClient.connectFromStoredSession({
      sessionOwnerUserId: ownerId,
    });
    if (res.ok) {
      this.logger.log('Userbot: подключение восстановлено watchdog после деплоя');
    } else {
      this.logger.warn(`Userbot: watchdog restore failed: ${res.error ?? 'unknown'}`);
    }
  }

  private async getUserbotPollIntervalMs(): Promise<number> {
    return this.getNumberSetting(
      'TELEGRAM_USERBOT_POLL_INTERVAL_MS',
      USERBOT_POLL_INTERVAL_MS,
      500,
      60_000,
    );
  }

  /**
   * После деплоя MTProto-клиент в памяти пуст; строка сессии в глобальных настройках остаётся.
   * Восстанавливаем по владельцу AuthUser (`TELEGRAM_USERBOT_SESSION_OWNER_USER_ID`), без привязки к выбранному кабинету.
   * Если ключ владельца пуст и в БД ровно один AuthUser — используется он (и затем записывается в настройки).
   * Отключение: env `TELEGRAM_USERBOT_SKIP_STARTUP_RESTORE=true`.
   * Ограничение: одна глобальная `TELEGRAM_USERBOT_SESSION` на процесс; при нескольких репликах API возможны гонки и повторная авторизация.
   */
  private async tryRestoreUserbotOnStartup(): Promise<void> {
    if (String(process.env.TELEGRAM_USERBOT_SKIP_STARTUP_RESTORE ?? '').trim().toLowerCase() === 'true') {
      this.logger.log('Userbot: пропуск восстановления сессии при старте (TELEGRAM_USERBOT_SKIP_STARTUP_RESTORE)');
      return;
    }
    const [enabled, session] = await Promise.all([
      this.getBoolSetting('TELEGRAM_USERBOT_ENABLED', false),
      this.settings.get('TELEGRAM_USERBOT_SESSION'),
    ]);
    if (!enabled || !session?.trim()) {
      return;
    }
    const ownerId = await this.resolveSessionOwnerUserIdForRestore();
    if (!ownerId) {
      this.logger.warn(
        'Userbot: восстановление при старте пропущено — неизвестен владелец сессии (войдите по QR или задайте TELEGRAM_USERBOT_SESSION_OWNER_USER_ID; при одном AuthUser в БД владелец подставится автоматически).',
      );
      return;
    }
    const res = await this.userbotClient.connectFromStoredSession({
      sessionOwnerUserId: ownerId,
    });
    if (res.ok) {
      this.logger.log('Userbot: сессия восстановлена при старте API из сохранённой строки');
    } else {
      this.logger.warn(`Userbot: при старте не удалось восстановить сессию: ${res.error ?? 'unknown'}`);
    }
  }

  /**
   * AuthUser, для которого поднимается глобальная MTProto-сессия при старте/watchdog.
   */
  private async resolveSessionOwnerUserIdForRestore(): Promise<string | null> {
    const fromSettings = (
      await this.settings.get(TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY)
    )?.trim();
    if (fromSettings) {
      return fromSettings;
    }
    const n = await this.prisma.authUser.count();
    if (n === 1) {
      const u = await this.prisma.authUser.findFirst({ select: { id: true } });
      const id = String(u?.id ?? '').trim();
      return id || null;
    }
    this.logger.debug(
      'Userbot: владелец сессии не задан (TELEGRAM_USERBOT_SESSION_OWNER_USER_ID) и в БД не один AuthUser — восстановление без явного владельца пропущено',
    );
    return null;
  }

  /**
   * Те же предпосылки, что у watchdog/старта: userbot включён в настройках и есть строка сессии.
   * Без кабинетного контекста — глобальное состояние процесса API.
   */
  private async isGlobalUserbotDisconnectedWhileExpected(): Promise<
    false | { reason: string }
  > {
    const [enabled, session] = await Promise.all([
      this.getBoolSetting('TELEGRAM_USERBOT_ENABLED', false),
      this.settings.get('TELEGRAM_USERBOT_SESSION'),
    ]);
    if (!enabled || !session?.trim()) {
      return false;
    }
    if (this.userbotClient.isAuthKeyDuplicateBackoffActive()) {
      return false;
    }
    const ownerId = await this.resolveSessionOwnerUserIdForRestore();
    if (!ownerId) {
      return {
        reason:
          'не задан владелец сессии (TELEGRAM_USERBOT_SESSION_OWNER_USER_ID; при нескольких AuthUser нужен явный владелец)',
      };
    }
    const client = this.userbotClient.getClientForOwnerUserId(ownerId);
    const connected = Boolean(
      client && (await this.userbotClient.isClientAuthorized(client)),
    );
    if (connected) {
      return false;
    }
    return { reason: 'MTProto-клиент не поднят или не авторизован в этом процессе API' };
  }

  /**
   * Пока userbot ожидаемо должен быть онлайн, но GramJS не подключён — каждую минуту POST на CRITICAL_NOTIFY_URL.
   * Выкл.: `TELEGRAM_USERBOT_DISCONNECTED_CRITICAL_CRON=false`.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async criticalNotifyIfUserbotDisconnected(): Promise<void> {
    if (
      String(process.env.TELEGRAM_USERBOT_DISCONNECTED_CRITICAL_CRON ?? '')
        .trim()
        .toLowerCase() === 'false'
    ) {
      return;
    }
    const down = await this.isGlobalUserbotDisconnectedWhileExpected();
    if (!down) {
      return;
    }
    const text = `[CRITICAL userbot] Userbot не подключён: ${down.reason}. Проверьте /telegram-userbot и логи API. ${new Date().toISOString()}`;
    await postCriticalNotifyText(text, (m) => this.logger.warn(m));
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
      const dedupMessageKey = `${chatId}:${messageId}`;
      const existingIngest = await this.prisma.tgUserbotIngest.findUnique({
        where: { dedupMessageKey },
        select: { status: true },
      });
      const skipRecencyFilter =
        existingIngest != null &&
        (USERBOT_INGEST_EDIT_REQUEUE_STATUSES as readonly string[]).includes(existingIngest.status);
      if (!skipRecencyFilter && !(await this.userbotScan.isMessageRecent(createdAt))) {
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

  /**
   * После успешного attach клиента: кэш включённых чатов; если для кабинета ещё нет привязанных
   * диалогов — первая синхронизация групп (как POST chats/sync) без ручного нажатия.
   */
  private async onAfterUserbotAttach(): Promise<void> {
    await this.refreshEnabledChatsCache();
    let cabinetId = this.cabinetContext.getCabinetId();
    if (!cabinetId) {
      const sessionOwner = (
        await this.settings.get(TELEGRAM_USERBOT_SESSION_OWNER_USER_ID_KEY)
      )?.trim();
      if (sessionOwner) {
        const cab = await this.prisma.cabinet.findFirst({
          where: { ownerUserId: sessionOwner },
          orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
          select: { id: true },
        });
        cabinetId = cab?.id ?? null;
      }
    }
    if (!cabinetId) {
      this.logger.warn(
        'onAfterUserbotAttach: нет кабинета для автосинхронизации (контекст и кабинет владельца сессии)',
      );
      return;
    }
    const sid = cabinetId;
    await this.cabinetContext.runWithCabinet(sid, async () => {
      const chatsLinked = await this.prisma.tgUserbotChat.count({
        where: { cabinetSources: { some: { cabinetId: sid } } },
      });
      if (chatsLinked > 0) {
        return;
      }
      try {
        const r = await this.syncChats();
        if (!r.ok) {
          this.logger.warn(
            `onAfterUserbotAttach: syncChats не выполнена (${r.error ?? 'unknown'}) — можно синхронизировать вручную.`,
          );
        } else {
          this.logger.log(`onAfterUserbotAttach: первая синхронизация чатов, upserted=${r.upserted}`);
        }
      } catch (e) {
        this.logger.warn(`onAfterUserbotAttach: syncChats исключение: ${formatError(e)}`);
      }
    });
  }

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
