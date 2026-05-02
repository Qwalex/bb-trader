import { Injectable, Logger } from '@nestjs/common';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { UserbotSignalHashService } from '../userbot-signal-hash.service';
import {
  USERBOT_INLINE_TEXT_MAX_CHARS,
  USERBOT_SIGNAL_LEVELS_EDIT_WATCH_POLL_MS,
  USERBOT_SIGNAL_LEVELS_EDIT_WATCH_TTL_MS,
} from '../telegram-userbot.constants';
import { extractSignalExternalId, readString } from '../utils/telegram-userbot-parse.util';
import { TelegramUserbotIngestService } from './telegram-userbot-ingest.service';
import { TelegramUserbotIngestSignalLookupService } from './telegram-userbot-ingest-signal-lookup.service';

/**
 * Наблюдение за правкой сообщения в Telegram после ошибки validateSignalLevels (poll + повтор в очередь).
 */
@Injectable()
export class TelegramUserbotIngestLevelsWatchService {
  private readonly logger = new Logger(TelegramUserbotIngestLevelsWatchService.name);
  private readonly signalLevelsValidationWatchTimers = new Map<string, NodeJS.Timeout>();
  private readonly signalLevelsValidationWatchDeadlineMs = new Map<string, number>();
  private readonly signalLevelsValidationWatchInflight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly appLog: AppLogService,
    private readonly cabinets: CabinetService,
    private readonly userbotSignalHash: UserbotSignalHashService,
    private readonly signalLookup: TelegramUserbotIngestSignalLookupService,
    private readonly ingest: TelegramUserbotIngestService,
  ) {}

  clearAllSignalLevelsValidationWatches(): void {
    for (const id of this.signalLevelsValidationWatchTimers.keys()) {
      this.clearSignalLevelsValidationWatch(id);
    }
  }

  /**
   * После ошибки validateSignalLevels: опрос Telegram; при смене текста — полный автоповтор
   * (очередь по каждому кабинету, с обходом подтверждения).
   */
  scheduleSignalLevelsValidationEditWatch(ingestId: string): void {
    this.clearSignalLevelsValidationWatch(ingestId);
    const deadlineMs = Date.now() + USERBOT_SIGNAL_LEVELS_EDIT_WATCH_TTL_MS;
    this.signalLevelsValidationWatchDeadlineMs.set(ingestId, deadlineMs);
    const timer = setInterval(() => {
      void this.tickSignalLevelsValidationEditWatch(ingestId);
    }, USERBOT_SIGNAL_LEVELS_EDIT_WATCH_POLL_MS);
    this.signalLevelsValidationWatchTimers.set(ingestId, timer);
    void this.appLog.append('info', 'telegram', 'Userbot: наблюдение за правкой сообщения после ошибки уровней', {
      ingestId,
      pollMs: USERBOT_SIGNAL_LEVELS_EDIT_WATCH_POLL_MS,
      ttlMs: USERBOT_SIGNAL_LEVELS_EDIT_WATCH_TTL_MS,
    });
  }

  private clearSignalLevelsValidationWatch(ingestId: string): void {
    const t = this.signalLevelsValidationWatchTimers.get(ingestId);
    if (t) {
      clearInterval(t);
      this.signalLevelsValidationWatchTimers.delete(ingestId);
    }
    this.signalLevelsValidationWatchDeadlineMs.delete(ingestId);
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

  private async tickSignalLevelsValidationEditWatch(ingestId: string): Promise<void> {
    const deadlineMs = this.signalLevelsValidationWatchDeadlineMs.get(ingestId);
    if (deadlineMs == null) {
      this.clearSignalLevelsValidationWatch(ingestId);
      return;
    }
    if (Date.now() > deadlineMs) {
      this.clearSignalLevelsValidationWatch(ingestId);
      void this.appLog.append('info', 'telegram', 'Userbot: истекло ожидание правки сообщения (уровни)', {
        ingestId,
      });
      return;
    }
    if (this.signalLevelsValidationWatchInflight.has(ingestId)) {
      return;
    }
    this.signalLevelsValidationWatchInflight.add(ingestId);
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
        this.clearSignalLevelsValidationWatch(ingestId);
        return;
      }
      if (row.status === 'placed' || row.status === 'cancelled_by_confirmation') {
        this.clearSignalLevelsValidationWatch(ingestId);
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
        'Userbot: текст сообщения в канале изменился (наблюдение уровней)',
        { id: row.id, chatId: row.chatId, messageId: row.messageId },
        { signalHash: row.signalHash, status: row.status },
      );

      const oldHash = row.signalHash?.trim() ?? '';
      if (oldHash) {
        await this.userbotSignalHash.release(oldHash);
      }
      await this.prisma.tgUserbotIngest.update({
        where: { id: ingestId },
        data: { text: fresh, signalHash: null },
      });

      const metaForJob = {
        replyToMessageId: meta.replyToMessageId,
        signalExternalId: extractSignalExternalId(fresh),
      };
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
            status: 'ignored',
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
            bypassConfirmationForAutoRetry: true,
          },
          route,
        });
      }
    } catch (e) {
      this.logger.warn(
        `tickSignalLevelsValidationEditWatch ingest=${ingestId}: ${formatError(e)}`,
      );
    } finally {
      this.signalLevelsValidationWatchInflight.delete(ingestId);
    }
  }
}
