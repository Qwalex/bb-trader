import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UserbotPublishService {
  constructor(private readonly prisma: PrismaService) {}

  async listPublishGroups(workspaceId: string) {
    const prismaAny = this.prisma as any;
    const rows = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { workspaceId },
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
  }, workspaceId: string) {
    const title = body.title?.trim() ?? '';
    const chatId = body.chatId?.trim() ?? '';
    const enabled = body.enabled !== false;
    const publishEveryN = Math.max(1, Math.trunc(Number(body.publishEveryN ?? 1) || 1));
    if (!title) return { ok: false, error: 'title обязателен' };
    if (!chatId) return { ok: false, error: 'chatId обязателен' };

    if (body.id?.trim()) {
      const id = body.id.trim();
      const prismaAny = this.prisma as any;
      const updated = await prismaAny.tgUserbotPublishGroup.updateMany({
        where: { id, workspaceId },
        data: { title, chatId, enabled, publishEveryN },
      });
      if (!updated || Number(updated.count ?? 0) === 0) {
        return { ok: false, error: 'publish-группа не найдена' };
      }
      const item = await prismaAny.tgUserbotPublishGroup.findFirst({
        where: { id, workspaceId },
      });
      return { ok: true, item };
    }

    const prismaAny = this.prisma as any;
    const created = await prismaAny.tgUserbotPublishGroup.create({
      data: { workspaceId, title, chatId, enabled, publishEveryN },
    });
    return { ok: true, item: created };
  }

  async deletePublishGroup(id: string, workspaceId: string) {
    const v = id.trim();
    if (!v) return { ok: false, error: 'id обязателен' };
    const prismaAny = this.prisma as any;
    await prismaAny.tgUserbotPublishGroup.deleteMany({ where: { id: v, workspaceId } });
    return { ok: true };
  }
}
