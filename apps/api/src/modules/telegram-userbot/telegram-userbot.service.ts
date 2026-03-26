import { createHash } from 'node:crypto';

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { normalizeTradingPair, type SignalDto } from '@repo/shared';
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

type MessageKind = 'signal' | 'close' | 'reentry' | 'result' | 'other';
type UserbotFilterKind = 'signal' | 'close' | 'result' | 'reentry';
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
const USERBOT_MIN_BALANCE_USD_DEFAULT = 3;
const USERBOT_BALANCE_CHECK_CACHE_MS = 30_000;
const USERBOT_FILTER_MATCH_THRESHOLD = 0.34;

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
  private balanceCheckCache:
    | {
        checkedAtMs: number;
        balanceUsd: number | undefined;
        minBalanceUsd: number;
      }
    | undefined;

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

  async listFilterGroups() {
    const [chatRows, patternRows] = await Promise.all([
      this.prisma.tgUserbotChat.findMany({
        orderBy: { title: 'asc' },
        select: { title: true, chatId: true },
      }),
      this.prisma.tgUserbotFilterExample.findMany({
        where: { enabled: true },
        orderBy: { groupName: 'asc' },
        select: { groupName: true },
      }),
    ]);
    const names = new Set<string>();
    for (const row of chatRows) {
      const v = typeof row.title === 'string' ? row.title.trim() : '';
      if (v) names.add(String(v));
    }
    for (const row of patternRows) {
      const v = typeof row.groupName === 'string' ? row.groupName.trim() : '';
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
        createdAt: true,
      },
    });
    return { items: rows };
  }

  async createFilterExample(body: {
    groupName?: string;
    kind?: 'signal' | 'close' | 'result' | 'reentry';
    example?: string;
  }) {
    const groupName = body.groupName?.trim() ?? '';
    const kind = body.kind;
    const example = body.example?.trim() ?? '';
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
      data: { groupName, kind, example, enabled: true },
      select: { id: true, groupName: true, kind: true, example: true, createdAt: true },
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
        await this.processIngestRecord(row, text);
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
          const replyToMessageId = this.extractReplyToMessageId(
            m.replyTo ?? m.reply_to ?? m.replyToMsgId ?? m.reply_to_msg_id,
          );
          readTextMessages += 1;
          await this.ingestChatMessage(chat.chatId, messageId, text, {
            replyToMessageId,
          });
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
      await this.ingestChatMessage(chatId, String(messageId), text.trim(), {
        replyToMessageId,
      });
    } catch (e) {
      const msg = formatError(e);
      this.logger.error(`handleIncomingMessage failed: ${msg}`);
    }
  };

  private async ingestChatMessage(
    chatId: string,
    messageId: string,
    text: string,
    meta?: { replyToMessageId?: string },
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
      meta,
      { enforceBalanceGuard: true },
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
    meta?: { replyToMessageId?: string },
    options?: { enforceBalanceGuard?: boolean },
  ): Promise<void> {
    try {
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

      const chatMeta = await this.prisma.tgUserbotChat.findUnique({
        where: { chatId: ingest.chatId },
        select: { title: true },
      });
      const groupName = chatMeta?.title?.trim() || ingest.chatId;
      const patternKind = await this.matchFilterKindByExamples(groupName, text);

      const useAiClassifier = await this.getBoolSetting(
        'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
        true,
      );
      const replyToMessageId = meta?.replyToMessageId?.trim() || undefined;
      const quotedText = replyToMessageId
        ? await this.fetchChatMessageText(ingest.chatId, replyToMessageId)
        : undefined;
      const cls = await this.classifyMessage(
        text,
        useAiClassifier,
        patternKind,
        groupName,
        replyToMessageId,
        quotedText,
      );
      const kind = cls.kind;
      const aiRequest = cls.aiRequest;
      const aiResponse = cls.aiResponse;
      const hasQuotedSource = Boolean(replyToMessageId);

      if (kind === 'reentry') {
        if (!hasQuotedSource) {
          await this.updateIngest(ingest.id, {
            classification: 'other',
            status: 'ignored',
            error: 'Reentry-сообщение без цитаты исходного сигнала',
            aiRequest,
            aiResponse,
          });
          return;
        }
        const reentry = await this.tryReentryFromReply({
          chatId: ingest.chatId,
          messageId: ingest.messageId,
          text,
          replyToMessageId,
        });
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
        if (!hasQuotedSource) {
          await this.updateIngest(ingest.id, {
            classification: 'other',
            status: 'ignored',
            error: 'Close-сообщение без цитаты исходного сигнала',
            aiRequest,
            aiResponse,
          });
          return;
        }
        const closeResult = await this.tryCloseSignalFromReply({
          chatId: ingest.chatId,
          messageId: ingest.messageId,
          replyToMessageId,
        });
        await this.updateIngest(ingest.id, {
          classification: 'result',
          status: closeResult.ok ? 'closed_by_reply' : 'ignored',
          error: closeResult.ok ? null : closeResult.error,
          aiRequest,
          aiResponse,
        });
        return;
      }

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
        const parseError = parsed.ok === false ? parsed.error : parsed.prompt;
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
      signal.source = chatMeta?.title;

      if (
        await this.bybit.wouldDuplicateActivePairDirection(
          signal.pair,
          signal.direction,
        )
      ) {
        await this.updateIngest(ingest.id, {
          classification: 'signal',
          status: 'duplicate_signal',
          error: `Активная позиция/сигнал по паре ${signal.pair} (${signal.direction})`,
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

      const place = await this.bybit.placeSignalOrders(signal, text, {
        chatId: ingest.chatId,
        messageId: ingest.messageId,
      });
      if (!place.ok) {
        const placeError = formatError(place.error);
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
      const err = formatError(e);
      await this.updateIngest(ingest.id, {
        status: 'parse_error',
        error: err,
      });
      await this.notifySignalFailureToBot({
        ingestId: ingest.id,
        chatId: ingest.chatId,
        token: this.extractTokenHint(text),
        stage: 'transcript',
        error: err,
      });
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
  ): Promise<UserbotFilterKind | undefined> {
    const rows = await this.prisma.tgUserbotFilterExample.findMany({
      where: { enabled: true },
      select: { groupName: true, kind: true, example: true },
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
    for (const row of scoped) {
      const kind = row.kind as UserbotFilterKind;
      const exampleText = typeof row.example === 'string' ? row.example : '';
      if (kind !== 'signal' && kind !== 'close' && kind !== 'result' && kind !== 'reentry') {
        continue;
      }
      if (!exampleText) {
        continue;
      }
      const score = this.computeTextSimilarity(String(text), String(exampleText));
      if (score > bestScore) {
        bestScore = score;
        bestKind = kind;
      }
    }
    if (!bestKind) {
      return undefined;
    }
    return bestScore >= USERBOT_FILTER_MATCH_THRESHOLD ? bestKind : undefined;
  }

  private async tryReentryFromReply(params: {
    chatId: string;
    messageId: string;
    text: string;
    replyToMessageId?: string;
  }): Promise<
    { ok: true; mode: 'updated' | 'replaced' } | { ok: false; error: string }
  > {
    const replyToMessageId = params.replyToMessageId?.trim();
    if (!replyToMessageId) {
      return { ok: false, error: 'Сообщение о перезаходе без цитаты исходного сигнала' };
    }

    const prev = await this.prisma.signal.findFirst({
      where: {
        deletedAt: null,
        sourceChatId: params.chatId,
        sourceMessageId: replyToMessageId,
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
      },
    });
    if (!prev) {
      return {
        ok: false,
        error: `Для цитаты ${params.chatId}:${replyToMessageId} активный сигнал не найден`,
      };
    }

    const parsed = await this.transcript.parse('text', { text: params.text });
    if (parsed.ok === false) {
      return { ok: false, error: parsed.error };
    }

    const updatePartial = parsed.ok === true ? parsed.signal : parsed.partial;
    const base = this.signalFromDb(prev);
    if (
      (updatePartial.pair && normalizeTradingPair(updatePartial.pair) !== normalizeTradingPair(base.pair)) ||
      (updatePartial.direction && updatePartial.direction !== base.direction)
    ) {
      return { ok: false, error: 'Перезаход не совпадает с исходным сигналом по паре/направлению' };
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
      await this.prisma.signalEvent.create({
        data: {
          signalId: prev.id,
          type: 'REENTRY_UPDATED',
          payload: JSON.stringify({
            sourceChatId: params.chatId,
            sourceMessageId: replyToMessageId,
            reentryMessageId: params.messageId,
            changedFields: {
              stopLoss: hasStopLossChanged
                ? { from: base.stopLoss, to: nextStopLoss }
                : null,
              takeProfits: hasTakeProfitsChanged
                ? { from: base.takeProfits, to: nextTakeProfits }
                : null,
            },
          }),
        },
      });
      void this.appLog.append('info', 'telegram', 'Перезаход: обновлены SL/TP в существующем сигнале', {
        signalId: prev.id,
        sourceChatId: params.chatId,
        sourceMessageId: params.replyToMessageId,
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
        typeof updatePartial.capitalPercent === 'number' && updatePartial.capitalPercent >= 0
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
      messageId: params.messageId,
    });
    if (!place.ok) {
      return { ok: false, error: formatError(place.error) };
    }

    await this.prisma.signal.update({
      where: { id: prev.id },
      data: { deletedAt: new Date() },
    });
    await this.prisma.signalEvent.create({
      data: {
        signalId: prev.id,
        type: 'REENTRY_REPLACED_OLD',
        payload: JSON.stringify({
          reason: 'Перезаход: старый сигнал заменен новым',
          sourceChatId: params.chatId,
          sourceMessageId: replyToMessageId,
          reentryMessageId: params.messageId,
          newSignalId: place.signalId,
        }),
      },
    });
    if (place.signalId) {
      await this.prisma.signalEvent.create({
        data: {
          signalId: place.signalId,
          type: 'REENTRY_REPLACED_NEW',
          payload: JSON.stringify({
            reason: 'Перезаход: создан новый сигнал',
            sourceChatId: params.chatId,
            sourceMessageId: params.messageId,
            oldSignalId: prev.id,
            mergedFields: {
              entries: nextSignal.entries,
              stopLoss: nextSignal.stopLoss,
              takeProfits: nextSignal.takeProfits,
              leverage: nextSignal.leverage,
              orderUsd: nextSignal.orderUsd,
              capitalPercent: nextSignal.capitalPercent,
            },
          }),
        },
      });
    }

    void this.appLog.append('info', 'telegram', 'Перезаход обработан', {
      oldSignalId: prev.id,
      newSignalId: place.signalId,
      sourceChatId: params.chatId,
      sourceMessageId: params.replyToMessageId,
      reentryMessageId: params.messageId,
    });

    return { ok: true, mode: 'replaced' };
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
      entries: this.parseEntriesJson(prev.entries),
      stopLoss: prev.stopLoss,
      takeProfits: this.parseEntriesJson(prev.takeProfits),
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
  }): Promise<{ ok: true } | { ok: false; error: string }> {
    const replyToMessageId = params.replyToMessageId?.trim();
    if (!replyToMessageId) {
      return { ok: false, error: 'Сообщение о закрытии без цитаты исходного сигнала' };
    }

    const signal = await this.prisma.signal.findFirst({
      where: {
        deletedAt: null,
        sourceChatId: params.chatId,
        sourceMessageId: replyToMessageId,
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        pair: true,
        direction: true,
        entries: true,
      },
    });
    if (!signal) {
      return {
        ok: false,
        error: `Для цитаты ${params.chatId}:${replyToMessageId} активный сигнал не найден`,
      };
    }

    const repliedText = await this.fetchChatMessageText(params.chatId, replyToMessageId);
    if (!repliedText) {
      return {
        ok: false,
        error: 'Не удалось прочитать текст сообщения из цитаты для сверки',
      };
    }

    const parsedQuoted = await this.transcript.parse('text', { text: repliedText });
    if (parsedQuoted.ok !== true) {
      return {
        ok: false,
        error: 'Не удалось распарсить сообщение из цитаты для сверки сигнала',
      };
    }

    const parsedEntry = parsedQuoted.signal.entries[0];
    const dbEntries = this.parseEntriesJson(signal.entries);
    const dbEntry = dbEntries[0];
    if (
      !this.isEntryCloseEnough(parsedEntry, dbEntry) ||
      normalizeTradingPair(parsedQuoted.signal.pair) !== normalizeTradingPair(signal.pair) ||
      parsedQuoted.signal.direction !== signal.direction
    ) {
      return {
        ok: false,
        error: 'Сверка token/side/entry с цитируемым сигналом не прошла',
      };
    }

    const closed = await this.bybit.closeSignalManually(signal.id);
    if (!closed.ok) {
      return {
        ok: false,
        error: closed.error ?? closed.details ?? 'Не удалось закрыть сделку на Bybit',
      };
    }
    await this.prisma.signalEvent.create({
      data: {
        signalId: signal.id,
        type: 'CANCELLED_BY_CHAT',
        payload: JSON.stringify({
          reason: 'Сигнал отменен в чате (closed/cancel)',
          sourceChatId: params.chatId,
          sourceMessageId: replyToMessageId,
          closeMessageId: params.messageId,
        }),
      },
    });

    void this.appLog.append(
      'info',
      'telegram',
      'Сделка закрыта по сообщению closed с цитатой',
      {
        sourceChatId: params.chatId,
        sourceMessageId: replyToMessageId,
        closeMessageId: params.messageId,
        signalId: signal.id,
      },
    );
    return { ok: true };
  }

  private async fetchChatMessageText(
    chatId: string,
    messageId: string,
  ): Promise<string | undefined> {
    if (!this.client || !(await this.isClientAuthorized(this.client))) {
      return undefined;
    }
    try {
      const list = (await this.client.getMessages(chatId, {
        ids: [Number(messageId)],
        limit: 1,
      })) as unknown as Array<Record<string, unknown>>;
      const msg = list[0];
      return this.readString(msg?.message);
    } catch (e) {
      this.logger.warn(
        `fetchChatMessageText failed chat=${chatId} msg=${messageId}: ${formatError(e)}`,
      );
      return undefined;
    }
  }

  private parseEntriesJson(raw: string): number[] {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0);
    } catch {
      return [];
    }
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

  private async notifySignalFailureToBot(params: {
    ingestId: string;
    chatId: string;
    token: string;
    stage: 'transcript' | 'bybit';
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
    if (!notify.ok) {
      this.logger.warn(
        `Failed to notify bot about signal error ingestId=${params.ingestId}: ${notify.error ?? 'unknown'}`,
      );
    }
  }

  private async classifyMessage(
    text: string,
    useAiClassifier: boolean,
    preferredKind?: UserbotFilterKind,
    groupName?: string,
    replyToMessageId?: string,
    quotedText?: string,
  ): Promise<{ kind: MessageKind; aiRequest?: string; aiResponse?: string }> {
    if (preferredKind) {
      return {
        kind: preferredKind,
        aiRequest: this.limitTrace(
          JSON.stringify({
            operation: 'classifyMessage',
            source: 'group_filter_example',
            groupName: groupName ?? null,
            preferredKind,
          }),
        ),
        aiResponse: this.limitTrace(
          JSON.stringify({
            forcedKind: preferredKind,
            reason: 'matched by user examples for group',
          }),
        ),
      };
    }
    if (!useAiClassifier) {
      return { kind: 'other' };
    }
    const ai = await this.transcript.classifyTradingMessage(text, {
      replyToMessageId,
      quotedText,
    });
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
          `Баланс USDT ниже порога ${snapshot.minBalanceUsd.toFixed(2)} — сообщение пропущено`,
      };
    }
    return { ignore: false };
  }

  private async getBalanceGuardSnapshot(): Promise<{
    minBalanceUsd: number;
    balanceUsd: number | null;
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
    if (
      this.balanceCheckCache &&
      now - this.balanceCheckCache.checkedAtMs < USERBOT_BALANCE_CHECK_CACHE_MS &&
      this.balanceCheckCache.minBalanceUsd === minBalanceUsd
    ) {
      balanceUsd = this.balanceCheckCache.balanceUsd;
    } else {
      balanceUsd = await this.bybit.getUnifiedUsdtBalance();
      this.balanceCheckCache = { checkedAtMs: now, balanceUsd, minBalanceUsd };
    }

    const paused =
      balanceUsd !== undefined &&
      Number.isFinite(balanceUsd) &&
      balanceUsd < minBalanceUsd;
    const reason =
      balanceUsd !== undefined &&
      Number.isFinite(balanceUsd) &&
      balanceUsd < minBalanceUsd
        ? `Автоматическая установка ордеров приостановлена: баланс ${balanceUsd.toFixed(2)}$ ниже допустимого порога ${minBalanceUsd.toFixed(2)}$`
        : undefined;
    return {
      minBalanceUsd,
      balanceUsd: balanceUsd ?? null,
      paused,
      reason,
    };
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
