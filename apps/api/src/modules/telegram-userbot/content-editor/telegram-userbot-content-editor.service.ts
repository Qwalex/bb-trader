import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { TranscriptService } from '../../transcript/transcript.service';
import { TelegramUserbotMirrorService } from '../mirror/telegram-userbot-mirror.service';
import type {
  ContentPostClassification,
  ContentPostDto,
} from './telegram-userbot-content-editor.types';

@Injectable()
export class TelegramUserbotContentEditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly transcript: TranscriptService,
    private readonly userbotMirror: TelegramUserbotMirrorService,
  ) {}

  private mapPost(row: {
    id: string;
    ingestId: string;
    sourceChatId: string;
    sourceMessageId: string;
    sourceTitle: string | null;
    classification: string;
    originalText: string;
    editedText: string | null;
    status: string;
    publishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    _count?: { publications: number };
  }): ContentPostDto {
    const edited = row.editedText?.trim();
    return {
      id: row.id,
      ingestId: row.ingestId,
      sourceChatId: row.sourceChatId,
      sourceMessageId: row.sourceMessageId,
      sourceTitle: row.sourceTitle,
      classification: row.classification as ContentPostClassification,
      originalText: row.originalText,
      editedText: row.editedText,
      displayText: edited && edited.length > 0 ? edited : row.originalText,
      status: row.status as ContentPostDto['status'],
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      publicationCount: row._count?.publications ?? 0,
    };
  }

  async upsertFromIngest(params: {
    ingestId: string;
    sourceChatId: string;
    sourceMessageId: string;
    sourceTitle?: string | null;
    classification: ContentPostClassification;
    originalText: string;
  }): Promise<void> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const prismaAny = this.prisma as any;
    const existing = await prismaAny.tgUserbotContentPost.findUnique({
      where: { ingestId: params.ingestId },
      select: { id: true, editedText: true },
    });
    if (existing) {
      await prismaAny.tgUserbotContentPost.update({
        where: { id: existing.id },
        data: {
          originalText: params.originalText,
          sourceTitle: params.sourceTitle ?? null,
          classification: params.classification,
        },
      });
      return;
    }
    await prismaAny.tgUserbotContentPost.create({
      data: {
        cabinetId,
        ingestId: params.ingestId,
        sourceChatId: params.sourceChatId,
        sourceMessageId: params.sourceMessageId,
        sourceTitle: params.sourceTitle ?? null,
        classification: params.classification,
        originalText: params.originalText,
        status: 'draft',
      },
    });
  }

  async listPosts(options?: {
    status?: string;
    classification?: string;
    limit?: number;
  }): Promise<{ items: ContentPostDto[] }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const limit = Math.min(Math.max(Math.trunc(Number(options?.limit ?? 100) || 100), 1), 500);
    const where: Record<string, unknown> = { cabinetId };
    const status = options?.status?.trim();
    const classification = options?.classification?.trim();
    if (status) where.status = status;
    if (classification === 'analysis' || classification === 'content') {
      where.classification = classification;
    }
    const prismaAny = this.prisma as any;
    const rows = await prismaAny.tgUserbotContentPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { _count: { select: { publications: true } } },
    });
    return { items: rows.map((row: Parameters<typeof this.mapPost>[0]) => this.mapPost(row)) };
  }

  async getPost(id: string): Promise<{ ok: true; item: ContentPostDto } | { ok: false; error: string }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const v = id.trim();
    if (!v) return { ok: false, error: 'id обязателен' };
    const prismaAny = this.prisma as any;
    const row = await prismaAny.tgUserbotContentPost.findFirst({
      where: { id: v, cabinetId },
      include: { _count: { select: { publications: true } } },
    });
    if (!row) return { ok: false, error: 'Пост не найден' };
    return { ok: true, item: this.mapPost(row) };
  }

  async updatePost(
    id: string,
    body: { editedText?: string | null },
  ): Promise<{ ok: true; item: ContentPostDto } | { ok: false; error: string }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const v = id.trim();
    if (!v) return { ok: false, error: 'id обязателен' };
    const prismaAny = this.prisma as any;
    const row = await prismaAny.tgUserbotContentPost.findFirst({
      where: { id: v, cabinetId },
      select: { id: true },
    });
    if (!row) return { ok: false, error: 'Пост не найден' };
    const editedText =
      body.editedText === null || body.editedText === undefined
        ? null
        : String(body.editedText);
    await prismaAny.tgUserbotContentPost.update({
      where: { id: row.id },
      data: { editedText, status: 'draft' },
    });
    const updated = await this.getPost(row.id);
    if (!updated.ok) return updated;
    return { ok: true, item: updated.item };
  }

  async aiRewritePost(
    id: string,
    body: { instruction?: string },
  ): Promise<
    | { ok: true; item: ContentPostDto; debug?: { model?: string; request?: string; response?: string } }
    | { ok: false; error: string; debug?: { model?: string; request?: string; response?: string } }
  > {
    const current = await this.getPost(id);
    if (!current.ok) return current;
    const rewrite = await this.transcript.rewriteContentPost({
      classification: current.item.classification,
      text: current.item.displayText,
      instruction: body.instruction,
      openrouterLogContext: {
        ingestId: current.item.ingestId,
        stage: 'content_rewrite',
      },
    });
    if (!rewrite.ok || !rewrite.text) {
      return { ok: false, error: rewrite.error ?? 'AI не вернул текст', debug: rewrite.debug };
    }
    const saved = await this.updatePost(id, { editedText: rewrite.text });
    if (!saved.ok) return saved;
    return { ok: true, item: saved.item, debug: rewrite.debug };
  }

  async publishPost(
    id: string,
  ): Promise<
    | {
        ok: true;
        item: ContentPostDto;
        results: Array<{
          publishGroupId: string;
          title: string;
          targetChatId: string;
          status: 'posted' | 'failed';
          targetMessageId?: string | null;
          error?: string | null;
        }>;
      }
    | { ok: false; error: string }
  > {
    const current = await this.getPost(id);
    if (!current.ok) return current;
    const text = current.item.displayText.trim();
    if (text.length < 2) return { ok: false, error: 'Текст поста слишком короткий' };

    const cabinetId = this.cabinetContext.getCabinetId();
    const prismaAny = this.prisma as any;
    const groups = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { cabinetId, enabled: true, contentPublishEnabled: true },
      orderBy: { title: 'asc' },
    });
    if (groups.length === 0) {
      return { ok: false, error: 'Нет групп с включённой публикацией контента' };
    }

    const results: Array<{
      publishGroupId: string;
      title: string;
      targetChatId: string;
      status: 'posted' | 'failed';
      targetMessageId?: string | null;
      error?: string | null;
    }> = [];

    for (const g of groups) {
      const out = await this.userbotMirror.sendMirrorMessage({
        targetChatId: g.chatId,
        text,
      });
      await prismaAny.tgUserbotContentPublication.create({
        data: {
          contentPostId: current.item.id,
          publishGroupId: g.id,
          targetChatId: g.chatId,
          targetMessageId: out.ok ? out.messageId : null,
          status: out.ok ? 'posted' : 'failed',
          error: out.ok ? null : out.error,
        },
      });
      results.push({
        publishGroupId: g.id,
        title: g.title,
        targetChatId: g.chatId,
        status: out.ok ? 'posted' : 'failed',
        targetMessageId: out.ok ? out.messageId : null,
        error: out.ok ? null : out.error,
      });
    }

    const anyPosted = results.some((r) => r.status === 'posted');
    if (anyPosted) {
      await prismaAny.tgUserbotContentPost.update({
        where: { id: current.item.id },
        data: { status: 'published', publishedAt: new Date() },
      });
    } else {
      return {
        ok: false,
        error: `Публикация не удалась: ${results.map((r) => r.error ?? 'ошибка').join('; ')}`,
      };
    }

    const updated = await this.getPost(current.item.id);
    if (!updated.ok) return updated;
    return { ok: true, item: updated.item, results };
  }

  async saveContentPublishGroups(body: {
    enabledGroupIds?: string[];
  }): Promise<{ ok: true; items: Array<{ id: string; contentPublishEnabled: boolean }> }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const enabled = new Set(
      (body.enabledGroupIds ?? []).map((id) => String(id).trim()).filter(Boolean),
    );
    const prismaAny = this.prisma as any;
    const groups = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { cabinetId },
      select: { id: true },
    });
    await this.prisma.$transaction(
      groups.map((g: { id: string }) =>
        prismaAny.tgUserbotPublishGroup.update({
          where: { id: g.id },
          data: { contentPublishEnabled: enabled.has(g.id) },
        }),
      ),
    );
    const rows = await prismaAny.tgUserbotPublishGroup.findMany({
      where: { cabinetId },
      orderBy: [{ enabled: 'desc' }, { title: 'asc' }],
      select: { id: true, contentPublishEnabled: true },
    });
    return { ok: true, items: rows };
  }
}
