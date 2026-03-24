import { createHash } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { SignalDto } from '@repo/shared';
import { NewMessage } from 'telegram/events';
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import * as QRCode from 'qrcode';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { BybitService } from '../bybit/bybit.service';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../telegram/telegram.service';
import { TranscriptService } from '../transcript/transcript.service';

type MessageKind = 'signal' | 'result' | 'other';
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

const USERBOT_POLL_INTERVAL_MS = 2000;
const USERBOT_MAX_MESSAGE_AGE_MINUTES_DEFAULT = 10;

@Injectable()
export class TelegramUserbotService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramUserbotService.name);

  private client: TelegramClient | null = null;
  private messageHandlerRegistered = false;
  private enabledChatIds = new Set<string>();

  private qrClient: TelegramClient | null = null;
  private qrTask: Promise<void> | null = null;
  private qrState: QrState = { phase: 'idle' };
  private pollTimer: NodeJS.Timeout | null = null;
  private pollInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly transcript: TranscriptService,
    private readonly bybit: BybitService,
    private readonly appLog: AppLogService,
    private readonly telegramBot: TelegramService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshEnabledChatsCache();
    this.startPollingLoop();
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
      pollMs: USERBOT_POLL_INTERVAL_MS,
      pollingInFlight: this.pollInFlight,
      qr: this.qrState,
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
      { connectionRetries: 5 },
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
    await this.stopQrClient();
    const qrClient = new TelegramClient(
      new StringSession(''),
      creds.apiId,
      creds.apiHash,
      { connectionRetries: 5 },
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
    return this.prisma.tgUserbotChat.findMany({
      orderBy: [{ enabled: 'desc' }, { title: 'asc' }],
    });
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
    await this.processIngestRecord(ingest, text);
    return { ok: true };
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
        : 150;
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
        for (const m of list) {
          const createdAt = this.extractMessageDate(m.date);
          if (!createdAt || createdAt < start) {
            continue;
          }
          if (!(await this.isMessageRecent(createdAt))) {
            continue;
          }
          readMessages += 1;
          const text = this.readString(m.message);
          const messageId = this.readNumericString(m.id);
          if (!text || !messageId) {
            continue;
          }
          readTextMessages += 1;
          await this.ingestChatMessage(chat.chatId, messageId, text);
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

  private startPollingLoop() {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setInterval(() => {
      void this.pollTick();
    }, USERBOT_POLL_INTERVAL_MS);
  }

  private stopPollingLoop() {
    if (!this.pollTimer) {
      return;
    }
    clearInterval(this.pollTimer);
    this.pollTimer = null;
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
      await this.scanTodayMessagesCore(80, false);
    } catch (e) {
      this.logger.warn(`Userbot pollTick failed: ${formatError(e)}`);
    } finally {
      this.pollInFlight = false;
    }
  }

  async setChatEnabled(chatId: string, enabled: boolean) {
    await this.prisma.tgUserbotChat.upsert({
      where: { chatId },
      create: { chatId, title: chatId, enabled },
      update: { enabled },
    });
    await this.refreshEnabledChatsCache();
    return { ok: true };
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
      await this.ingestChatMessage(chatId, String(messageId), text.trim());
    } catch (e) {
      const msg = formatError(e);
      this.logger.error(`handleIncomingMessage failed: ${msg}`);
    }
  };

  private async ingestChatMessage(
    chatId: string,
    messageId: string,
    text: string,
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
      return;
    }

    await this.processIngestRecord(
      {
        id: ingest.id,
        chatId: ingest.chatId,
        messageId: ingest.messageId,
        signalHash: null,
        status: ingest.status,
      },
      text,
    );
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
  ): Promise<void> {
    try {
      await this.updateIngest(ingest.id, {
        classification: 'other',
        status: 'ignored',
        error: null,
        aiRequest: null,
        aiResponse: null,
      });

      const useAiClassifier = await this.getBoolSetting(
        'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
        true,
      );
      const cls = await this.classifyMessage(text, useAiClassifier);
      const kind = cls.kind;
      const aiRequest = cls.aiRequest;
      const aiResponse = cls.aiResponse;
      if (kind !== 'signal') {
        await this.updateIngest(ingest.id, {
          classification: kind,
          status: 'ignored',
          aiRequest,
          aiResponse,
        });
        return;
      }

      const parsed = await this.transcript.parse('text', { text });
      if (parsed.ok !== true) {
        await this.updateIngest(ingest.id, {
          classification: parsed.ok === 'incomplete' ? 'other' : 'signal',
          status: parsed.ok === 'incomplete' ? 'ignored' : 'parse_error',
          error: parsed.ok === false ? parsed.error : parsed.prompt,
          aiRequest,
          aiResponse,
        });
        return;
      }

      const signal = parsed.signal;
      const chatMeta = await this.prisma.tgUserbotChat.findUnique({
        where: { chatId: ingest.chatId },
      });
      signal.source = chatMeta?.title;

      if (await this.bybit.wouldDuplicateActivePair(signal.pair)) {
        await this.updateIngest(ingest.id, {
          classification: 'signal',
          status: 'duplicate_signal',
          error: `Активная позиция/сигнал по паре ${signal.pair}`,
          aiRequest,
          aiResponse,
        });
        return;
      }

      const signalHash = this.computeSignalHash(signal);
      const canReuseExistingHash =
        ingest.signalHash === signalHash && ingest.status !== 'placed';
      const isNewSignal = canReuseExistingHash
        ? true
        : await this.tryCreateSignalHash(signalHash);
      if (!isNewSignal) {
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
        await this.updateIngest(ingest.id, {
          classification: 'signal',
          status: 'blocked_by_setting',
          signalHash,
          error:
            'Авторазмещение отключено настройкой TELEGRAM_USERBOT_REQUIRE_CONFIRMATION=true',
          aiRequest,
          aiResponse,
        });
        const req = await this.telegramBot.requestExternalSignalConfirmation({
          ingestId: ingest.id,
          signal,
          rawMessage: text,
          onResult: async (result) => {
            if (result.decision === 'rejected') {
              await this.updateIngest(ingest.id, {
                status: 'cancelled_by_confirmation',
                error: `Отклонено пользователем ${result.actorUserId ?? ''}`.trim(),
              });
              return;
            }
            if (!result.ok) {
              await this.updateIngest(ingest.id, {
                status: 'place_error',
                error:
                  result.error ??
                  'Подтверждение получено, но ордер не удалось выставить',
              });
              return;
            }
            await this.updateIngest(ingest.id, {
              status: 'placed',
              error: null,
            });
          },
        });
        if (!req.ok) {
          await this.updateIngest(ingest.id, {
            error: `Ожидание подтверждения: ${req.error ?? 'не удалось отправить запрос в бот'}`,
          });
        } else {
          await this.updateIngest(ingest.id, {
            error: `Ожидает подтверждение в боте (доставлено: ${req.deliveredTo})`,
          });
        }
        return;
      }

      const place = await this.bybit.placeSignalOrders(signal, text);
      if (!place.ok) {
        await this.updateIngest(ingest.id, {
          classification: 'signal',
          status: 'place_error',
          signalHash,
          error: formatError(place.error),
          aiRequest,
          aiResponse,
        });
        return;
      }

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
      await this.updateIngest(ingest.id, {
        status: 'parse_error',
        error: formatError(e),
      });
    }
  }

  private async classifyMessage(
    text: string,
    useAiClassifier: boolean,
  ): Promise<{ kind: MessageKind; aiRequest?: string; aiResponse?: string }> {
    if (!useAiClassifier) {
      return { kind: 'other' };
    }
    const ai = await this.transcript.classifyTradingMessage(text);
    const aiRequest = this.limitTrace(
      ai.debug?.request ??
        JSON.stringify({
          operation: 'classifyTradingMessage',
          text,
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

  private async isMessageRecent(createdAt: Date): Promise<boolean> {
    const maxAgeMinutes = await this.getNumberSetting(
      'TELEGRAM_USERBOT_MAX_MESSAGE_AGE_MINUTES',
      USERBOT_MAX_MESSAGE_AGE_MINUTES_DEFAULT,
      1,
      1440,
    );
    const maxAgeMs = maxAgeMinutes * 60_000;
    return Date.now() - createdAt.getTime() <= maxAgeMs;
  }

  private async tryCreateSignalHash(hash: string): Promise<boolean> {
    try {
      await this.prisma.tgUserbotSignalHash.create({ data: { hash } });
      return true;
    } catch (e) {
      if (this.isUniqueConstraintError(e)) {
        return false;
      }
      throw e;
    }
  }

  private computeSignalHash(signal: SignalDto): string {
    const normalized = {
      pair: signal.pair.trim().toUpperCase(),
      direction: signal.direction,
      leverage: Number(signal.leverage),
      entries: signal.entries.map((v) => Number(v).toFixed(8)),
      stopLoss: Number(signal.stopLoss).toFixed(8),
      takeProfits: signal.takeProfits.map((v) => Number(v).toFixed(8)),
    };
    return createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex');
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
