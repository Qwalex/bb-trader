import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';
import {
  USERBOT_INLINE_TEXT_MAX_CHARS,
  USERBOT_MAX_QUEUE_DEFAULT,
  USERBOT_PROCESSING_CONCURRENCY,
} from '../telegram-userbot.constants';
import type { IngestProcessJob, ProcessIngestOptions } from '../telegram-userbot.types';
import { readString } from '../utils/telegram-userbot-parse.util';

type ProcessIngestRecordFn = (
  ingest: IngestProcessJob['ingest'],
  text: string,
  meta?: IngestProcessJob['meta'],
  options?: ProcessIngestOptions,
) => Promise<void>;

@Injectable()
export class TelegramUserbotIngestService {
  private readonly logger = new Logger(TelegramUserbotIngestService.name);
  private readonly processingQueue: IngestProcessJob[] = [];
  private readonly processingQueuedIds = new Set<string>();
  private readonly processingActiveIngestIds = new Set<string>();
  private processingWorkersActive = 0;

  private processIngestRecordFn: ProcessIngestRecordFn | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly appLog: AppLogService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  setProcessIngestRecord(fn: ProcessIngestRecordFn): void {
    this.processIngestRecordFn = fn;
  }

  getQueueDepth(): number {
    return this.processingQueue.length;
  }

  getWorkersActive(): number {
    return this.processingWorkersActive;
  }

  async ingestChatMessage(
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
      const existing = await this.prisma.tgUserbotIngest.findUnique({
        where: { dedupMessageKey },
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
      if (!existing) {
        void this.appLog.append('debug', 'telegram', 'Userbot: duplicate ingest skipped (нет строки)', {
          chatId,
          messageId,
          dedupMessageKey,
        });
        return;
      }
      const nextText = text.trim();
      const prevText = (readString(existing.text) ?? '').trim();
      if (prevText === nextText) {
        void this.appLog.append('debug', 'telegram', 'Userbot: duplicate ingest без изменений текста', {
          chatId,
          messageId,
          dedupMessageKey,
        });
        return;
      }
      await this.prisma.tgUserbotIngest.update({
        where: { id: existing.id },
        data: { text: nextText },
      });
      void this.appLog.append('info', 'telegram', 'Userbot: текст ingest обновлён из Telegram', {
        chatId,
        messageId,
        dedupMessageKey,
        ingestId: existing.id,
        prevLen: prevText.length,
        nextLen: nextText.length,
      });
      const cabinetIdsDup = await this.cabinets.listEnabledCabinetIdsForChat(chatId);
      for (const cabinetId of cabinetIdsDup) {
        const route = await this.prisma.cabinetIngestRoute.upsert({
          where: { cabinetId_ingestId: { cabinetId, ingestId: existing.id } },
          create: {
            cabinetId,
            ingestId: existing.id,
            chatId,
            classification: 'other',
            status: 'queued',
          },
          update: {
            chatId,
            classification: 'other',
            status: 'queued',
            error: null,
            aiRequest: null,
            aiResponse: null,
          },
          select: { id: true, cabinetId: true },
        });
        this.enqueueIngestJob({
          ingest: {
            id: existing.id,
            chatId: existing.chatId,
            messageId: existing.messageId,
            signalHash: null,
            status: existing.status,
          },
          text: nextText.length > USERBOT_INLINE_TEXT_MAX_CHARS ? null : nextText,
          textLen: nextText.length,
          meta,
          options: {
            enforceBalanceGuard: true,
            ...options,
            ingestCreatedAt: existing.createdAt,
          },
          route,
        });
      }
      return;
    }

    const cabinetIds = await this.cabinets.listEnabledCabinetIdsForChat(chatId);
    for (const cabinetId of cabinetIds) {
      const route = await this.prisma.cabinetIngestRoute.upsert({
        where: { cabinetId_ingestId: { cabinetId, ingestId: ingest.id } },
        create: {
          cabinetId,
          ingestId: ingest.id,
          chatId,
          classification: 'other',
          status: 'queued',
        },
        update: {
          chatId,
          classification: 'other',
          status: 'queued',
          error: null,
          aiRequest: null,
          aiResponse: null,
        },
        select: { id: true, cabinetId: true },
      });
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
        route,
      });
    }
  }

  enqueueIngestJob(job: IngestProcessJob): void {
    const queueKey = `${job.ingest.id}:${job.route?.id ?? 'default'}`;
    if (this.processingQueuedIds.has(queueKey)) {
      return;
    }
    this.processingQueuedIds.add(queueKey);

    void (async () => {
      const maxQueue = await this.getNumberSetting(
        'TELEGRAM_USERBOT_MAX_QUEUE',
        USERBOT_MAX_QUEUE_DEFAULT,
        10,
        10_000,
      );
      if (this.processingQueue.length >= maxQueue) {
        this.processingQueuedIds.delete(queueKey);
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
      this.processingQueuedIds.delete(queueKey);
      this.logger.warn(`enqueueIngestJob failed: ${formatError(e)}`);
    });
  }

  private pumpIngestQueue(): void {
    while (
      this.processingWorkersActive < USERBOT_PROCESSING_CONCURRENCY &&
      this.processingQueue.length > 0
    ) {
      const nextIdx = this.processingQueue.findIndex(
        (item) => !this.processingActiveIngestIds.has(item.ingest.id),
      );
      if (nextIdx < 0) {
        return;
      }
      const [job] = this.processingQueue.splice(nextIdx, 1);
      if (!job) {
        return;
      }
      this.processingQueuedIds.delete(`${job.ingest.id}:${job.route?.id ?? 'default'}`);
      this.processingActiveIngestIds.add(job.ingest.id);
      this.processingWorkersActive += 1;
      void this.runIngestJob(job).finally(() => {
        this.processingActiveIngestIds.delete(job.ingest.id);
        this.processingWorkersActive -= 1;
        this.pumpIngestQueue();
      });
    }
  }

  private async runIngestJob(job: IngestProcessJob): Promise<void> {
    const processor = this.processIngestRecordFn;
    if (!processor) {
      this.logger.error(`runIngestJob: handler не настроен ingest=${job.ingest.id}`);
      await this.updateIngest(job.ingest.id, {
        classification: 'other',
        status: 'ignored',
        error: 'ingest processor not configured',
      });
      return;
    }
    try {
      const row = await this.prisma.tgUserbotIngest.findUnique({
        where: { id: job.ingest.id },
        select: { text: true, createdAt: true },
      });
      const text = readString(row?.text) ?? '';
      const cabinetId = job.route?.cabinetId ?? (await this.cabinets.getDefaultCabinetId());
      await this.cabinetContext.runWithCabinet(cabinetId, async () => {
        await processor(job.ingest, text, job.meta, {
          ...job.options,
          ingestCreatedAt: job.options?.ingestCreatedAt ?? row?.createdAt,
        });
      });
      if (job.route?.id) {
        const ingestRow = await this.prisma.tgUserbotIngest.findUnique({
          where: { id: job.ingest.id },
          select: {
            classification: true,
            status: true,
            error: true,
            aiRequest: true,
            aiResponse: true,
          },
        });
        await this.prisma.cabinetIngestRoute.update({
          where: { id: job.route.id },
          data: {
            classification: ingestRow?.classification ?? 'other',
            status: ingestRow?.status ?? 'ignored',
            error: ingestRow?.error ?? null,
            aiRequest: ingestRow?.aiRequest ?? null,
            aiResponse: ingestRow?.aiResponse ?? null,
          },
        });
      }
    } catch (e) {
      const error = formatError(e);
      this.logger.error(`runIngestJob failed ingest=${job.ingest.id}: ${error}`);
      await this.updateIngest(job.ingest.id, {
        classification: 'other',
        status: 'ignored',
        error,
      });
      if (job.route?.id) {
        await this.prisma.cabinetIngestRoute
          .update({
            where: { id: job.route.id },
            data: {
              classification: 'other',
              status: 'ignored',
              error,
            },
          })
          .catch(() => undefined);
      }
    }
  }

  async updateIngest(id: string, data: Prisma.TgUserbotIngestUpdateInput): Promise<void> {
    await this.prisma.tgUserbotIngest.update({
      where: { id },
      data,
    });
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

  private isUniqueConstraintError(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    return code === 'P2002';
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
