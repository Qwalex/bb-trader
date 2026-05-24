import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { TelegramSpotFlowService } from '../../telegram/services/telegram-spot-flow.service';
import { UserbotSignalHashService } from '../userbot-signal-hash.service';
import {
  USERBOT_INLINE_TEXT_MAX_CHARS,
  USERBOT_INGEST_EDIT_WATCH_POLL_MS,
  USERBOT_INGEST_EDIT_WATCH_TTL_MS,
} from '../telegram-userbot.constants';
import { extractSignalExternalId, readString } from '../utils/telegram-userbot-parse.util';
import { TelegramUserbotIngestService } from './telegram-userbot-ingest.service';
import { TelegramUserbotIngestSignalLookupService } from './telegram-userbot-ingest-signal-lookup.service';

const ACTIVE_SIGNAL_STATUSES = ['PENDING', 'ORDERS_PLACED', 'OPEN', 'PARSED'] as const;

/**
 * Наблюдение за правкой сообщения в Telegram после retriable ingest и awaiting_edit (poll + повтор в очередь).
 */
@Injectable()
export class TelegramUserbotIngestEditWatchService {
  private readonly logger = new Logger(TelegramUserbotIngestEditWatchService.name);
  private readonly editWatchTimers = new Map<string, NodeJS.Timeout>();
  private readonly editWatchDeadlineMs = new Map<string, number>();
  private readonly editWatchInflight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLog: AppLogService,
    private readonly cabinets: CabinetService,
    private readonly userbotSignalHash: UserbotSignalHashService,
    private readonly signalLookup: TelegramUserbotIngestSignalLookupService,
    private readonly ingest: TelegramUserbotIngestService,
    @Inject(forwardRef(() => TelegramSpotFlowService))
    private readonly spotFlow: TelegramSpotFlowService,
  ) {}

  clearEditWatch(ingestId: string): void {
    this.clearEditWatchTimer(ingestId);
  }

  clearAllEditWatches(): void {
    for (const id of this.editWatchTimers.keys()) {
      this.clearEditWatchTimer(id);
    }
  }

  /**
   * После parse_incomplete / place_error / awaiting_edit: опрос Telegram; при смене текста — автоповтор ingest.
   */
  async scheduleEditWatch(ingestId: string): Promise<void> {
    if (this.spotFlow.hasActiveSpotDialogForIngest(ingestId)) {
      void this.appLog.append('info', 'telegram', 'Userbot: edit-watch пропущен — активный spot-диалог', {
        ingestId,
      });
      return;
    }
    const row = await this.prisma.tgUserbotIngest.findUnique({
      where: { id: ingestId },
      select: { id: true, chatId: true, messageId: true },
    });
    if (!row) {
      return;
    }
    if (await this.hasActiveSignalForMessage(row.chatId, row.messageId)) {
      void this.appLog.append('info', 'telegram', 'Userbot: watch пропущен — активная сделка по сообщению', {
        ingestId,
        chatId: row.chatId,
        messageId: row.messageId,
      });
      return;
    }

    this.clearEditWatchTimer(ingestId);
    const deadlineMs = Date.now() + USERBOT_INGEST_EDIT_WATCH_TTL_MS;
    this.editWatchDeadlineMs.set(ingestId, deadlineMs);
    const timer = setInterval(() => {
      void this.tickEditWatch(ingestId);
    }, USERBOT_INGEST_EDIT_WATCH_POLL_MS);
    this.editWatchTimers.set(ingestId, timer);
    void this.appLog.append('info', 'telegram', 'Userbot: наблюдение за правкой сообщения', {
      ingestId,
      pollMs: USERBOT_INGEST_EDIT_WATCH_POLL_MS,
      ttlMs: USERBOT_INGEST_EDIT_WATCH_TTL_MS,
    });
  }

  private clearEditWatchTimer(ingestId: string): void {
    const t = this.editWatchTimers.get(ingestId);
    if (t) {
      clearInterval(t);
      this.editWatchTimers.delete(ingestId);
    }
    this.editWatchDeadlineMs.delete(ingestId);
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

  private async tickEditWatch(ingestId: string): Promise<void> {
    if (this.spotFlow.hasActiveSpotDialogForIngest(ingestId)) {
      return;
    }
    const deadlineMs = this.editWatchDeadlineMs.get(ingestId);
    if (deadlineMs == null) {
      this.clearEditWatchTimer(ingestId);
      return;
    }
    if (Date.now() > deadlineMs) {
      this.clearEditWatchTimer(ingestId);
      void this.appLog.append('info', 'telegram', 'Userbot: истекло ожидание правки сообщения', {
        ingestId,
      });
      return;
    }
    if (this.editWatchInflight.has(ingestId)) {
      return;
    }
    this.editWatchInflight.add(ingestId);
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
        this.clearEditWatch(ingestId);
        return;
      }
      if (row.status === 'placed' || row.status === 'cancelled_by_confirmation') {
        this.clearEditWatch(ingestId);
        return;
      }
      if (await this.hasActiveSignalForMessage(row.chatId, row.messageId)) {
        this.clearEditWatch(ingestId);
        void this.appLog.append('info', 'telegram', 'Userbot: наблюдение остановлено — активная сделка по сообщению', {
          ingestId,
          chatId: row.chatId,
          messageId: row.messageId,
        });
        return;
      }
      const meta = await this.signalLookup.fetchChatMessageMeta(row.chatId, row.messageId);
      if (meta.error) {
        return;
      }
      const fresh = (meta.text ?? '').trim();
      if (!fresh) {
        return;
      }
      const prev = (readString(row.text) ?? '').trim();
      if (fresh === prev) {
        return;
      }

      this.appendIngestStageLog(
        'info',
        'Userbot: текст сообщения в канале изменился (edit-watch)',
        { id: row.id, chatId: row.chatId, messageId: row.messageId },
        { signalHash: row.signalHash, status: row.status },
      );

      const oldHash = row.signalHash?.trim() ?? '';
      const cabinetIds = await this.cabinets.listEnabledCabinetIdsForChat(row.chatId);
      if (oldHash) {
        for (const cabinetId of cabinetIds) {
          await this.userbotSignalHash.releaseForCabinetAndHash(cabinetId, oldHash);
        }
      }
      await this.prisma.tgUserbotIngest.update({
        where: { id: ingestId },
        data: { text: fresh, signalHash: null },
      });

      const metaForJob = {
        replyToMessageId: meta.replyToMessageId,
        signalExternalId: extractSignalExternalId(fresh),
      };
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
          text: fresh.length > USERBOT_INLINE_TEXT_MAX_CHARS ? null : fresh,
          textLen: fresh.length,
          meta: metaForJob,
          options: {
            enforceBalanceGuard: true,
            source: 'poll',
            telegramReceivedAt: new Date(),
            ingestCreatedAt: row.createdAt,
            suppressPlacementFailureExternalNotify: true,
            bypassConfirmationForAutoRetry: row.status !== 'awaiting_edit',
          },
          route,
        });
      }
    } catch (e) {
      this.logger.warn(`tickEditWatch ingest=${ingestId}: ${formatError(e)}`);
    } finally {
      this.editWatchInflight.delete(ingestId);
    }
  }
}
