import { Injectable, Logger } from '@nestjs/common';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import {
  USERBOT_INLINE_TEXT_MAX_CHARS,
  USERBOT_PARSE_ERROR_RETRY_POLL_MS,
  USERBOT_PARSE_ERROR_RETRY_TTL_MS,
} from '../telegram-userbot.constants';
import { extractSignalExternalId, readString } from '../utils/telegram-userbot-parse.util';
import { TelegramUserbotIngestService } from './telegram-userbot-ingest.service';

const ACTIVE_SIGNAL_STATUSES = ['PENDING', 'ORDERS_PLACED', 'OPEN', 'PARSED'] as const;

/**
 * Повторный parse после parse_error (например «Model did not return valid JSON»):
 * re-enqueue ingest каждые 5 мин в течение 1 ч.
 */
@Injectable()
export class TelegramUserbotIngestParseRetryService {
  private readonly logger = new Logger(TelegramUserbotIngestParseRetryService.name);
  private readonly retryTimers = new Map<string, NodeJS.Timeout>();
  private readonly retryDeadlineMs = new Map<string, number>();
  private readonly retryAttempt = new Map<string, number>();
  private readonly retryInflight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLog: AppLogService,
    private readonly cabinets: CabinetService,
    private readonly ingest: TelegramUserbotIngestService,
  ) {}

  clearParseRetry(ingestId: string): void {
    this.clearParseRetryTimer(ingestId);
  }

  clearAllParseRetries(): void {
    for (const id of this.retryTimers.keys()) {
      this.clearParseRetryTimer(id);
    }
  }

  async scheduleParseRetry(ingestId: string): Promise<void> {
    if (this.retryTimers.has(ingestId)) {
      return;
    }
    const row = await this.prisma.tgUserbotIngest.findUnique({
      where: { id: ingestId },
      select: { id: true, chatId: true, messageId: true, status: true },
    });
    if (!row || row.status !== 'parse_error') {
      return;
    }
    if (await this.hasActiveSignalForMessage(row.chatId, row.messageId)) {
      void this.appLog.append('info', 'telegram', 'Userbot: parse-retry пропущен — активная сделка по сообщению', {
        ingestId,
        chatId: row.chatId,
        messageId: row.messageId,
      });
      return;
    }

    this.clearParseRetryTimer(ingestId);
    this.retryAttempt.set(ingestId, 0);
    this.retryDeadlineMs.set(ingestId, Date.now() + USERBOT_PARSE_ERROR_RETRY_TTL_MS);
    const timer = setInterval(() => {
      void this.tickParseRetry(ingestId);
    }, USERBOT_PARSE_ERROR_RETRY_POLL_MS);
    this.retryTimers.set(ingestId, timer);
    void this.appLog.append('info', 'telegram', 'Userbot: запланирован повтор parse после parse_error', {
      ingestId,
      pollMs: USERBOT_PARSE_ERROR_RETRY_POLL_MS,
      ttlMs: USERBOT_PARSE_ERROR_RETRY_TTL_MS,
    });
  }

  private clearParseRetryTimer(ingestId: string): void {
    const t = this.retryTimers.get(ingestId);
    if (t) {
      clearInterval(t);
      this.retryTimers.delete(ingestId);
    }
    this.retryDeadlineMs.delete(ingestId);
    this.retryAttempt.delete(ingestId);
  }

  private async hasActiveSignalForMessage(chatId: string, messageId: string): Promise<boolean> {
    const row = await this.prisma.signal.findFirst({
      where: {
        deletedAt: null,
        sourceChatId: chatId,
        sourceMessageId: messageId,
        status: { in: [...ACTIVE_SIGNAL_STATUSES] },
      },
      select: { id: true },
    });
    return row != null;
  }

  private async tickParseRetry(ingestId: string): Promise<void> {
    const deadlineMs = this.retryDeadlineMs.get(ingestId);
    if (deadlineMs == null) {
      this.clearParseRetryTimer(ingestId);
      return;
    }
    if (Date.now() > deadlineMs) {
      this.clearParseRetryTimer(ingestId);
      void this.appLog.append('info', 'telegram', 'Userbot: истекло окно повторов parse после parse_error', {
        ingestId,
        ttlMs: USERBOT_PARSE_ERROR_RETRY_TTL_MS,
      });
      return;
    }
    if (this.retryInflight.has(ingestId)) {
      return;
    }
    this.retryInflight.add(ingestId);
    const attempt = (this.retryAttempt.get(ingestId) ?? 0) + 1;
    this.retryAttempt.set(ingestId, attempt);

    try {
      const row = await this.prisma.tgUserbotIngest.findUnique({
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
      if (!row) {
        this.clearParseRetry(ingestId);
        return;
      }
      if (row.status !== 'parse_error') {
        this.clearParseRetry(ingestId);
        return;
      }
      if (await this.hasActiveSignalForMessage(row.chatId, row.messageId)) {
        this.clearParseRetry(ingestId);
        return;
      }

      const text = (readString(row.text) ?? '').trim();
      if (!text) {
        return;
      }

      void this.appLog.append('info', 'telegram', 'Userbot: повтор parse после parse_error', {
        ingestId,
        attempt,
        pollMs: USERBOT_PARSE_ERROR_RETRY_POLL_MS,
      });

      const meta = { signalExternalId: extractSignalExternalId(text) };
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
            signalHash: row.signalHash,
            status: row.status,
          },
          text: text.length > USERBOT_INLINE_TEXT_MAX_CHARS ? null : text,
          textLen: text.length,
          meta,
          options: {
            enforceBalanceGuard: true,
            source: 'parse-retry',
            ingestCreatedAt: row.createdAt,
            bypassConfirmationForAutoRetry: true,
            suppressParseFailureExternalNotify: true,
          },
          route,
        });
      }
    } catch (e) {
      this.logger.warn(`tickParseRetry ingest=${ingestId}: ${formatError(e)}`);
    } finally {
      this.retryInflight.delete(ingestId);
    }
  }
}
