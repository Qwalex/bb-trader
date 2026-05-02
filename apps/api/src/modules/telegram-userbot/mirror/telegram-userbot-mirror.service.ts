import { Injectable } from '@nestjs/common';
import type { SignalDto } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { TelegramUserbotClientService } from '../client/telegram-userbot-client.service';
import {
  formatMirrorCancelText,
  formatMirrorResultText,
  formatMirrorSignalText,
} from './telegram-userbot-mirror-format.util';

@Injectable()
export class TelegramUserbotMirrorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly userbotClient: TelegramUserbotClientService,
  ) {}

  async sendMirrorMessage(params: {
    targetChatId: string;
    text: string;
    replyToMessageId?: string;
  }): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
    const client = await this.userbotClient.getCurrentUserClient();
    if (!client || !(await this.userbotClient.isClientAuthorized(client))) {
      return { ok: false, error: 'Telegram userbot не авторизован' };
    }
    try {
      const sent = (await client.sendMessage(params.targetChatId, {
        message: params.text,
        ...(params.replyToMessageId
          ? { replyTo: Number(params.replyToMessageId) }
          : {}),
      })) as { id?: number };
      const mid = sent?.id;
      if (!Number.isFinite(mid)) {
        return { ok: false, error: 'Не удалось получить messageId отправленного сообщения' };
      }
      return { ok: true, messageId: String(mid) };
    } catch (e) {
      return { ok: false, error: formatError(e) };
    }
  }

  async publishSignalToMirrorGroups(params: {
    ingest: { id: string; chatId: string; messageId: string };
    signal: SignalDto;
    sourceChatTitle?: string;
  }): Promise<void> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const prismaAny = this.prisma as any;
    const groups = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { enabled: true, cabinetId },
      orderBy: { createdAt: 'asc' },
    });
    if (groups.length === 0) return;
    for (const g of groups) {
      const existing = await prismaAny.tgUserbotMirrorMessage.findFirst({
        where: {
          cabinetId,
          publishGroupId: g.id,
          ingestId: params.ingest.id,
          kind: 'signal',
        },
        select: { id: true },
      });
      if (existing) continue;
      const { shouldPublish, nextCounter } = await this.prisma.$transaction(async (tx) => {
        const txAny = tx as any;
        const row = await txAny.tgUserbotPublishGroup.findUnique({
          where: { id: g.id },
          select: { signalCounter: true, publishEveryN: true },
        });
        const current = Number(row?.signalCounter ?? 0) || 0;
        const n = Math.max(
          1,
          Number(row?.publishEveryN ?? g.publishEveryN ?? 1) || 1,
        );
        const next = current + 1;
        await txAny.tgUserbotPublishGroup.update({
          where: { id: g.id },
          data: { signalCounter: next },
        });
        return { shouldPublish: next % n === 0, nextCounter: next };
      });
      if (!shouldPublish) {
        await prismaAny.tgUserbotMirrorMessage.create({
          data: {
            publishGroupId: g.id,
            cabinetId,
            ingestId: params.ingest.id,
            sourceChatId: params.ingest.chatId,
            sourceMessageId: params.ingest.messageId,
            kind: 'signal',
            status: 'skipped_by_n',
            targetChatId: g.chatId,
            error: `Счетчик=${nextCounter}, публикуем каждый ${g.publishEveryN}`,
          },
        });
        continue;
      }
      const out = await this.sendMirrorMessage({
        targetChatId: g.chatId,
        text: formatMirrorSignalText(params.signal, params.sourceChatTitle),
      });
      await prismaAny.tgUserbotMirrorMessage.create({
        data: {
          publishGroupId: g.id,
          cabinetId,
          ingestId: params.ingest.id,
          sourceChatId: params.ingest.chatId,
          sourceMessageId: params.ingest.messageId,
          kind: 'signal',
          status: out.ok ? 'posted' : 'failed',
          targetChatId: g.chatId,
          targetMessageId: out.ok ? out.messageId : null,
          error: out.ok ? null : out.error,
        },
      });
    }
  }

  async publishOutcomeToMirrorGroups(params: {
    ingest: { id: string; chatId: string; messageId: string };
    kind: 'result' | 'cancel';
    text: string;
    rootSourceMessageId?: string;
  }): Promise<void> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const prismaAny = this.prisma as any;
    const groups = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { enabled: true, cabinetId },
      orderBy: { createdAt: 'asc' },
    });
    if (groups.length === 0) return;
    for (const g of groups) {
      const existing = await prismaAny.tgUserbotMirrorMessage.findFirst({
        where: {
          cabinetId,
          publishGroupId: g.id,
          ingestId: params.ingest.id,
          kind: params.kind,
        },
        select: { id: true },
      });
      if (existing) continue;
      if (!params.rootSourceMessageId) {
        await prismaAny.tgUserbotMirrorMessage.create({
          data: {
            publishGroupId: g.id,
            cabinetId,
            ingestId: params.ingest.id,
            sourceChatId: params.ingest.chatId,
            sourceMessageId: params.ingest.messageId,
            kind: params.kind,
            status: 'skipped_no_root',
            targetChatId: g.chatId,
            error: 'Не найден root source message',
          },
        });
        continue;
      }
      const rootPosted = await prismaAny.tgUserbotMirrorMessage.findFirst({
        where: {
          publishGroupId: g.id,
          cabinetId,
          kind: 'signal',
          sourceChatId: params.ingest.chatId,
          sourceMessageId: params.rootSourceMessageId,
          status: 'posted',
          targetMessageId: { not: null },
        },
        select: { targetMessageId: true },
      });
      if (!rootPosted?.targetMessageId) {
        await prismaAny.tgUserbotMirrorMessage.create({
          data: {
            publishGroupId: g.id,
            cabinetId,
            ingestId: params.ingest.id,
            sourceChatId: params.ingest.chatId,
            sourceMessageId: params.ingest.messageId,
            rootSourceChatId: params.ingest.chatId,
            rootSourceMessageId: params.rootSourceMessageId,
            kind: params.kind,
            status: 'skipped_no_root',
            targetChatId: g.chatId,
            error: 'Связанный сигнал не был опубликован из-за фильтра N или ошибки',
          },
        });
        continue;
      }
      const out = await this.sendMirrorMessage({
        targetChatId: g.chatId,
        text:
          params.kind === 'result'
            ? formatMirrorResultText(params.text)
            : formatMirrorCancelText(params.text),
        replyToMessageId: rootPosted.targetMessageId,
      });
      await prismaAny.tgUserbotMirrorMessage.create({
        data: {
          publishGroupId: g.id,
          cabinetId,
          ingestId: params.ingest.id,
          sourceChatId: params.ingest.chatId,
          sourceMessageId: params.ingest.messageId,
          rootSourceChatId: params.ingest.chatId,
          rootSourceMessageId: params.rootSourceMessageId,
          kind: params.kind,
          status: out.ok ? 'posted' : 'failed',
          targetChatId: g.chatId,
          targetMessageId: out.ok ? out.messageId : null,
          replyToTargetMessageId: rootPosted.targetMessageId,
          error: out.ok ? null : out.error,
        },
      });
    }
  }

  async listPublishGroups() {
    const cabinetId = this.cabinetContext.getCabinetId();
    const prismaAny = this.prisma as any;
    const rows = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { cabinetId },
      orderBy: [{ enabled: 'desc' }, { title: 'asc' }],
    });
    return { items: rows };
  }

  async createOrUpdatePublishGroup(body: {
    id?: string;
    title?: string;
    chatId?: string;
    enabled?: boolean;
    publishEveryN?: number;
  }) {
    const cabinetId = this.cabinetContext.getCabinetId();
    const title = body.title?.trim() ?? '';
    const chatId = body.chatId?.trim() ?? '';
    const enabled = body.enabled !== false;
    const publishEveryN = Math.max(1, Math.trunc(Number(body.publishEveryN ?? 1) || 1));
    if (!title) return { ok: false, error: 'title обязателен' };
    if (!chatId) return { ok: false, error: 'chatId обязателен' };

    if (body.id?.trim()) {
      const id = body.id.trim();
      const prismaAny = this.prisma as any;
      const updated = await prismaAny.tgUserbotPublishGroup.update({
        where: { id },
        data: { title, chatId, enabled, publishEveryN, cabinetId },
      });
      return { ok: true, item: updated };
    }

    const prismaAny = this.prisma as any;
    const created = await prismaAny.tgUserbotPublishGroup.create({
      data: { title, chatId, enabled, publishEveryN, cabinetId },
    });
    return { ok: true, item: created };
  }

  async deletePublishGroup(id: string) {
    const cabinetId = this.cabinetContext.getCabinetId();
    const v = id.trim();
    if (!v) return { ok: false, error: 'id обязателен' };
    const prismaAny = this.prisma as any;
    const row = await prismaAny.tgUserbotPublishGroup.findFirst({
      where: { id: v, cabinetId },
      select: { id: true },
    });
    if (!row) return { ok: false, error: 'publish-группа не найдена' };
    await prismaAny.tgUserbotPublishGroup.delete({ where: { id: row.id } });
    return { ok: true };
  }
}
