import { Injectable, Logger } from '@nestjs/common';
import { TelegramClient } from 'telegram';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { TelegramUserbotClientService } from '../client/telegram-userbot-client.service';
import { TelegramUserbotIngestService } from '../ingest/telegram-userbot-ingest.service';
import {
  USERBOT_MAX_MESSAGE_AGE_MINUTES_DEFAULT,
  USERBOT_POLL_FETCH_LIMIT,
} from '../telegram-userbot.constants';
import {
  extractMessageDate,
  extractReplyToMessageId,
  extractSignalExternalId,
  readNumericString,
  readString,
  startOfToday,
} from '../utils/telegram-userbot-parse.util';

@Injectable()
export class TelegramUserbotScanService {
  private readonly logger = new Logger(TelegramUserbotScanService.name);
  private readonly lastSeenMessageIds = new Map<string, number>();
  private pollInFlight = false;
  private messageRecencyCache:
    | {
        checkedAtMs: number;
        maxAgeMs: number;
      }
    | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly cabinets: CabinetService,
    private readonly settings: SettingsService,
    private readonly userbotClient: TelegramUserbotClientService,
    private readonly ingest: TelegramUserbotIngestService,
  ) {}

  getPollInFlight(): boolean {
    return this.pollInFlight;
  }

  noteLastSeenMessageId(chatId: string, messageId: number): void {
    const prev = this.lastSeenMessageIds.get(chatId) ?? 0;
    if (messageId > prev) {
      this.lastSeenMessageIds.set(chatId, messageId);
    }
  }

  async isMessageRecent(createdAt: Date): Promise<boolean> {
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

  async getTodayMetrics() {
    const start = startOfToday();
    const cabinetId = this.cabinetContext.getCabinetId();
    if (!cabinetId) {
      return {
        dayStart: start.toISOString(),
        readMessages: 0,
        signalsFound: 0,
        signalsPlaced: 0,
        noSignals: 0,
        parseIncomplete: 0,
        parseError: 0,
        recent: [],
      };
    }
    const [readMessages, signalsFound, signalsPlaced, parseIncomplete, parseError] =
      await Promise.all([
        this.prisma.cabinetIngestRoute.count({
          where: { cabinetId, createdAt: { gte: start } },
        }),
        this.prisma.cabinetIngestRoute.count({
          where: { cabinetId, createdAt: { gte: start }, classification: 'signal' },
        }),
        this.prisma.cabinetIngestRoute.count({
          where: { cabinetId, createdAt: { gte: start }, status: 'placed' },
        }),
        this.prisma.cabinetIngestRoute.count({
          where: { cabinetId, createdAt: { gte: start }, status: 'parse_incomplete' },
        }),
        this.prisma.cabinetIngestRoute.count({
          where: { cabinetId, createdAt: { gte: start }, status: 'parse_error' },
        }),
      ]);
    const recent = await this.prisma.cabinetIngestRoute.findMany({
      where: { cabinetId },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: {
        ingestId: true,
        chatId: true,
        ingest: {
          select: {
            messageId: true,
            text: true,
            aiRequest: true,
            aiResponse: true,
          },
        },
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
        id: row.ingestId,
        chatId: row.chatId,
        messageId: row.ingest.messageId,
        text: row.ingest.text,
        aiRequest: row.ingest.aiRequest,
        aiResponse: row.ingest.aiResponse,
        classification: row.classification,
        status: row.status,
        error: row.error,
        createdAt: row.createdAt,
        isToday: row.createdAt.getTime() >= start.getTime(),
      })),
    };
  }

  async scanTodayMessagesCore(
    limitPerChatRaw?: number,
    includeTodayMetrics = false,
    clientArg?: TelegramClient,
  ) {
    const client = clientArg ?? (await this.userbotClient.getCurrentUserClient());
    if (!client || !(await this.userbotClient.isClientAuthorized(client))) {
      return { ok: false, error: 'Userbot не подключен.' };
    }
    const enabledChats = await this.prisma.cabinetTelegramSource.findMany({
      where: {
        cabinetId: this.cabinetContext.getCabinetId() ?? undefined,
        enabled: true,
      },
      select: { chatId: true, chat: { select: { title: true } } },
    });
    const limitPerChat =
      typeof limitPerChatRaw === 'number' && Number.isFinite(limitPerChatRaw)
        ? Math.max(20, Math.min(500, Math.floor(limitPerChatRaw)))
        : USERBOT_POLL_FETCH_LIMIT;
    const start = startOfToday();
    let readMessages = 0;
    let readTextMessages = 0;
    let chatsProcessed = 0;
    const errors: Array<{ chatId: string; error: string }> = [];

    for (const chat of enabledChats) {
      try {
        const list = (await client.getMessages(chat.chatId, {
          limit: limitPerChat,
        })) as unknown as Array<Record<string, unknown>>;
        chatsProcessed += 1;
        const lastSeenMessageId = this.lastSeenMessageIds.get(chat.chatId) ?? 0;
        const enforceLastSeenCursor = !includeTodayMetrics;
        const candidates = list
          .map((m) => {
            const createdAt = extractMessageDate(m.date);
            const text = readString(m.message);
            const messageId = readNumericString(m.id);
            const messageIdNum = messageId ? Number(messageId) : NaN;
            return {
              createdAt,
              text,
              messageId,
              messageIdNum,
              replyToMessageId: extractReplyToMessageId(
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
            if (!enforceLastSeenCursor) {
              return true;
            }
            return row.messageIdNum > lastSeenMessageId;
          })
          .sort((a, b) => a.messageIdNum - b.messageIdNum);

        const enforceRecentWindow = !includeTodayMetrics;
        for (const m of candidates) {
          if (enforceRecentWindow && !(await this.isMessageRecent(m.createdAt!))) {
            continue;
          }
          readMessages += 1;
          readTextMessages += 1;
          this.noteLastSeenMessageId(chat.chatId, m.messageIdNum);
          await this.ingest.ingestChatMessage(
            chat.chatId,
            m.messageId!,
            m.text!,
            {
              replyToMessageId: m.replyToMessageId,
              signalExternalId: extractSignalExternalId(m.text),
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

  /** Опрос по всем подключённым клиентам (кабинет по owner user id). */
  async pollTick(shouldSkip: () => boolean): Promise<void> {
    if (this.pollInFlight) {
      return;
    }
    if (shouldSkip()) {
      return;
    }
    this.pollInFlight = true;
    try {
      for (const [userId, client] of this.userbotClient.clientsEntries()) {
        if (!(await this.userbotClient.isClientAuthorized(client))) {
          continue;
        }
        const ownerCabinets = await this.cabinets.listCabinetsForUser(userId);
        if (ownerCabinets.length === 0) {
          continue;
        }
        for (const cab of ownerCabinets) {
          await this.cabinetContext.runWithCabinet(cab.id, () =>
            this.scanTodayMessagesCore(USERBOT_POLL_FETCH_LIMIT, false, client),
          );
        }
      }
    } catch (e) {
      this.logger.warn(`Userbot pollTick failed: ${formatError(e)}`);
    } finally {
      this.pollInFlight = false;
    }
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
