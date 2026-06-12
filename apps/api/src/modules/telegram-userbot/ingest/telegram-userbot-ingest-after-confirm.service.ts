import { Injectable, Logger } from '@nestjs/common';

import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { TelegramUserbotIngestEditWatchService } from './telegram-userbot-ingest-edit-watch.service';
import { TelegramUserbotIngestService } from './telegram-userbot-ingest.service';
import { TelegramUserbotMirrorService } from '../mirror/telegram-userbot-mirror.service';
import { UserbotSignalHashService } from '../userbot-signal-hash.service';
import { mapPrismaSignalToDto } from '../../orders/signal-prisma-mapper.util';
import type { ExternalConfirmResultPayload } from './telegram-userbot-ingest-after-confirm.types';

@Injectable()
export class TelegramUserbotIngestAfterConfirmService {
  private readonly logger = new Logger(TelegramUserbotIngestAfterConfirmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: TelegramUserbotIngestService,
    private readonly editWatch: TelegramUserbotIngestEditWatchService,
    private readonly userbotMirror: TelegramUserbotMirrorService,
    private readonly cabinetContext: CabinetContextService,
    private readonly userbotSignalHash: UserbotSignalHashService,
  ) {}

  async handleAfterExternalConfirm(params: {
    cabinetId: string;
    ingestId: string;
    result: ExternalConfirmResultPayload;
  }): Promise<{ ok: boolean }> {
    const cabinetId = params.cabinetId.trim();
    const ingestId = params.ingestId.trim();
    const result = params.result;
    if (!cabinetId || !ingestId) {
      return { ok: false };
    }
    return this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const row = await this.prisma.tgUserbotIngest.findUnique({
        where: { id: ingestId },
        select: { id: true, chatId: true, messageId: true, signalHash: true },
      });
      if (!row) {
        this.logger.warn(`after-external-confirm: ingest not found ${ingestId}`);
        return { ok: false };
      }
      const ingest = { id: row.id, chatId: row.chatId, messageId: row.messageId };
      if (result.decision === 'rejected') {
        await this.ingest.updateIngest(ingest.id, {
          status: 'cancelled_by_confirmation',
          error: `Отклонено пользователем ${result.actorUserId ?? ''}`.trim(),
        });
        return { ok: true };
      }
      if (!result.ok) {
        await this.ingest.updateIngest(ingest.id, {
          status: 'place_error',
          error: result.error ?? 'Подтверждение получено, но ордер не удалось выставить',
        });
        const hash = String(row.signalHash ?? '').trim();
        if (hash) {
          await this.userbotSignalHash.releaseForCabinetAndHash(cabinetId, hash);
        }
        void this.editWatch.scheduleEditWatch(ingest.id);
        return { ok: true };
      }
      await this.ingest.updateIngest(ingest.id, {
        status: 'placed',
        error: null,
      });
      if (result.signalId) {
        const signalRow = await this.prisma.signal.findUnique({
          where: { id: result.signalId },
        });
        if (signalRow) {
          const chatMeta = row.chatId
            ? await this.prisma.tgUserbotChat.findUnique({
                where: { chatId: row.chatId },
                select: { title: true },
              })
            : null;
          await this.userbotMirror.publishSignalToMirrorGroups({
            ingest,
            signal: mapPrismaSignalToDto(signalRow),
            sourceChatTitle: chatMeta?.title ?? undefined,
          });
        }
        await this.userbotMirror.tryCreateQpulseForSignal(result.signalId);
      }
      return { ok: true };
    });
  }
}
