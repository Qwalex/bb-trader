import { Injectable } from '@nestjs/common';

import {
  CONTENT_COLLECT_KIND_VALUES,
  type ContentCollectKind,
} from '@repo/shared';

import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';
import { TranscriptService } from '../../transcript/transcript.service';
import { TelegramUserbotMirrorService } from '../mirror/telegram-userbot-mirror.service';
import {
  readCollectKinds,
  saveCollectKinds,
  shouldCollectContentKind,
} from './content-collect-settings.util';
import type {
  ContentCollectSettingsDto,
  ContentPostClassification,
  ContentPostDto,
} from './telegram-userbot-content-editor.types';

@Injectable()
export class TelegramUserbotContentEditorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly settings: SettingsService,
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

  async getCollectSettings(): Promise<ContentCollectSettingsDto> {
    const kinds = await readCollectKinds(this.settings);
    return { kinds };
  }

  async saveCollectSettings(body: {
    kinds?: string[];
  }): Promise<{ ok: true; kinds: string[] }> {
    const kinds = await saveCollectKinds(this.settings, body.kinds ?? []);
    return { ok: true, kinds };
  }

  async shouldCollectKind(kind: string): Promise<boolean> {
    const collectKinds = await readCollectKinds(this.settings);
    return shouldCollectContentKind(kind, collectKinds);
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
    classification?: string | string[];
    sourceChatId?: string;
    q?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: ContentPostDto[]; nextCursor?: string | null }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const limit = Math.min(Math.max(Math.trunc(Number(options?.limit ?? 100) || 100), 1), 500);
    const where: Record<string, unknown> = { cabinetId };
    const status = options?.status?.trim();
    if (status) where.status = status;
    const clsRaw = options?.classification;
    const clsList = Array.isArray(clsRaw)
      ? clsRaw.map((c) => String(c).trim()).filter(Boolean)
      : clsRaw?.trim()
        ? clsRaw.split(',').map((c) => c.trim()).filter(Boolean)
        : [];
    const allowedCls = clsList.filter((c): c is ContentCollectKind =>
      (CONTENT_COLLECT_KIND_VALUES as readonly string[]).includes(c),
    );
    if (allowedCls.length === 1) {
      where.classification = allowedCls[0];
    } else if (allowedCls.length > 1) {
      where.classification = { in: allowedCls };
    }
    const sourceChatId = options?.sourceChatId?.trim();
    if (sourceChatId) where.sourceChatId = sourceChatId;
    const q = options?.q?.trim();
    if (q) {
      where.OR = [
        { originalText: { contains: q, mode: 'insensitive' } },
        { editedText: { contains: q, mode: 'insensitive' } },
        { sourceTitle: { contains: q, mode: 'insensitive' } },
      ];
    }
    const from = options?.from?.trim();
    const to = options?.to?.trim();
    if (from || to) {
      const createdAt: Record<string, Date> = {};
      if (from) {
        const d = new Date(from);
        if (!Number.isNaN(d.getTime())) createdAt.gte = d;
      }
      if (to) {
        const d = new Date(to);
        if (!Number.isNaN(d.getTime())) createdAt.lte = d;
      }
      if (Object.keys(createdAt).length > 0) where.createdAt = createdAt;
    }
    const cursor = options?.cursor?.trim();
    if (cursor) {
      where.createdAt = {
        ...(typeof where.createdAt === 'object' ? (where.createdAt as object) : {}),
        lt: new Date(cursor),
      };
    }
    const prismaAny = this.prisma as any;
    const rows = await prismaAny.tgUserbotContentPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      include: { _count: { select: { publications: true } } },
    });
    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const items = slice.map((row: Parameters<typeof this.mapPost>[0]) => this.mapPost(row));
    const nextCursor =
      hasMore && slice.length > 0
        ? slice[slice.length - 1]!.createdAt.toISOString()
        : null;
    return { items, nextCursor };
  }

  async createGeneratedDraft(params: {
    text: string;
    classification: ContentPostClassification;
    sourcePosts: Array<{ id: string; sourceChatId?: string; sourceMessageId?: string }>;
    presetId?: string;
  }): Promise<{ ok: true; postId: string } | { ok: false; error: string }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const first = params.sourcePosts[0];
    const sourceChatId = first?.sourceChatId ?? 'generated';
    const sourceMessageId = first?.sourceMessageId ?? `preset:${Date.now()}`;
    const ingestKey = `generated:${params.presetId ?? 'manual'}:${Date.now()}`;
    const prismaAny = this.prisma as any;
    const row = await prismaAny.tgUserbotContentPost.create({
      data: {
        cabinetId,
        ingestId: ingestKey,
        sourceChatId,
        sourceMessageId,
        sourceTitle: 'AI generated',
        classification: params.classification,
        originalText: params.text,
        editedText: params.text,
        status: 'draft',
        generationPresetId: params.presetId ?? null,
      },
    });
    return { ok: true, postId: row.id };
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
    targetGroupIds?: string[],
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
    const groupWhere: Record<string, unknown> = {
      cabinetId,
      enabled: true,
      contentPublishEnabled: true,
    };
    const explicitIds = (targetGroupIds ?? [])
      .map((v) => String(v).trim())
      .filter(Boolean);
    if (explicitIds.length > 0) {
      groupWhere.id = { in: explicitIds };
    }
    const groups = await prismaAny.tgUserbotPublishGroup.findMany({
      where: groupWhere,
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

  async deletePost(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const v = id.trim();
    if (!v) return { ok: false, error: 'id обязателен' };
    const prismaAny = this.prisma as any;
    const row = await prismaAny.tgUserbotContentPost.findFirst({
      where: { id: v, cabinetId },
      select: { id: true },
    });
    if (!row) return { ok: false, error: 'Пост не найден' };
    await prismaAny.tgUserbotContentPost.delete({ where: { id: row.id } });
    return { ok: true };
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
