import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { appCalendarDayRange } from '@repo/shared';

import { PrismaService } from '../../../prisma/prisma.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';
import { parseSettingsBool } from '../../settings/settings-bool.util';
import { TranscriptService } from '../../transcript/transcript.service';
import { TelegramUserbotContentEditorService } from './telegram-userbot-content-editor.service';
import {
  parseJsonStringArray,
  stringifyJsonStringArray,
} from './content-collect-settings.util';
import { shouldRunCronNow } from './content-generation-cron.util';
import type {
  ContentGenerationPresetDto,
  ContentGenerationRunDto,
} from './telegram-userbot-content-editor.types';

function mapPreset(row: {
  id: string;
  name: string;
  enabled: boolean;
  sourceKindsJson: string;
  sourceGroupIdsJson: string;
  aiInstruction: string;
  outputStyle: string | null;
  dailyLimit: number;
  scheduleCron: string | null;
  autoPublish: boolean;
  targetGroupIdsJson: string;
  lastRunAt: Date | null;
  lastPublishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ContentGenerationPresetDto {
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    sourceKinds: parseJsonStringArray(row.sourceKindsJson),
    sourceGroupIds: parseJsonStringArray(row.sourceGroupIdsJson),
    aiInstruction: row.aiInstruction,
    outputStyle: row.outputStyle,
    dailyLimit: row.dailyLimit,
    scheduleCron: row.scheduleCron,
    autoPublish: row.autoPublish,
    targetGroupIds: parseJsonStringArray(row.targetGroupIdsJson),
    lastRunAt: row.lastRunAt ? row.lastRunAt.toISOString() : null,
    lastPublishedAt: row.lastPublishedAt ? row.lastPublishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class ContentGenerationPresetService {
  private readonly logger = new Logger(ContentGenerationPresetService.name);
  private schedulerInFlight = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly settings: SettingsService,
    private readonly transcript: TranscriptService,
    private readonly contentEditor: TelegramUserbotContentEditorService,
  ) {}

  async listPresets(): Promise<{ items: ContentGenerationPresetDto[] }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const rows = await (this.prisma as any).contentGenerationPreset.findMany({
      where: { cabinetId },
      orderBy: { createdAt: 'asc' },
    });
    return { items: rows.map((row: Parameters<typeof mapPreset>[0]) => mapPreset(row)) };
  }

  async createPreset(body: {
    name?: string;
    enabled?: boolean;
    sourceKinds?: string[];
    sourceGroupIds?: string[];
    aiInstruction?: string;
    outputStyle?: string | null;
    dailyLimit?: number;
    scheduleCron?: string | null;
    autoPublish?: boolean;
    targetGroupIds?: string[];
  }): Promise<{ ok: true; item: ContentGenerationPresetDto } | { ok: false; error: string }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const name = String(body.name ?? '').trim();
    if (!name) return { ok: false, error: 'Название пресета обязательно' };
    const row = await (this.prisma as any).contentGenerationPreset.create({
      data: {
        cabinetId,
        name,
        enabled: body.enabled !== false,
        sourceKindsJson: stringifyJsonStringArray(body.sourceKinds ?? ['analysis']),
        sourceGroupIdsJson: stringifyJsonStringArray(body.sourceGroupIds ?? []),
        aiInstruction: String(body.aiInstruction ?? ''),
        outputStyle: body.outputStyle?.trim() || null,
        dailyLimit: Math.max(1, Math.trunc(Number(body.dailyLimit) || 1)),
        scheduleCron: body.scheduleCron?.trim() || null,
        autoPublish: body.autoPublish === true,
        targetGroupIdsJson: stringifyJsonStringArray(body.targetGroupIds ?? []),
      },
    });
    return { ok: true, item: mapPreset(row) };
  }

  async updatePreset(
    id: string,
    body: Partial<{
      name: string;
      enabled: boolean;
      sourceKinds: string[];
      sourceGroupIds: string[];
      aiInstruction: string;
      outputStyle: string | null;
      dailyLimit: number;
      scheduleCron: string | null;
      autoPublish: boolean;
      targetGroupIds: string[];
    }>,
  ): Promise<{ ok: true; item: ContentGenerationPresetDto } | { ok: false; error: string }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const existing = await (this.prisma as any).contentGenerationPreset.findFirst({
      where: { id: id.trim(), cabinetId },
    });
    if (!existing) return { ok: false, error: 'Пресет не найден' };
    const row = await (this.prisma as any).contentGenerationPreset.update({
      where: { id: existing.id },
      data: {
        name: body.name != null ? String(body.name).trim() : undefined,
        enabled: body.enabled != null ? Boolean(body.enabled) : undefined,
        sourceKindsJson:
          body.sourceKinds != null
            ? stringifyJsonStringArray(body.sourceKinds)
            : undefined,
        sourceGroupIdsJson:
          body.sourceGroupIds != null
            ? stringifyJsonStringArray(body.sourceGroupIds)
            : undefined,
        aiInstruction:
          body.aiInstruction != null ? String(body.aiInstruction) : undefined,
        outputStyle:
          body.outputStyle !== undefined
            ? body.outputStyle?.trim() || null
            : undefined,
        dailyLimit:
          body.dailyLimit != null
            ? Math.max(1, Math.trunc(Number(body.dailyLimit) || 1))
            : undefined,
        scheduleCron:
          body.scheduleCron !== undefined
            ? body.scheduleCron?.trim() || null
            : undefined,
        autoPublish:
          body.autoPublish != null ? Boolean(body.autoPublish) : undefined,
        targetGroupIdsJson:
          body.targetGroupIds != null
            ? stringifyJsonStringArray(body.targetGroupIds)
            : undefined,
      },
    });
    return { ok: true, item: mapPreset(row) };
  }

  async deletePreset(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const row = await (this.prisma as any).contentGenerationPreset.findFirst({
      where: { id: id.trim(), cabinetId },
      select: { id: true },
    });
    if (!row) return { ok: false, error: 'Пресет не найден' };
    await (this.prisma as any).contentGenerationPreset.delete({ where: { id: row.id } });
    return { ok: true };
  }

  async listRuns(presetId: string, limit = 20): Promise<{ items: ContentGenerationRunDto[] }> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const preset = await (this.prisma as any).contentGenerationPreset.findFirst({
      where: { id: presetId.trim(), cabinetId },
      select: { id: true },
    });
    if (!preset) return { items: [] };
    const take = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const rows = await (this.prisma as any).contentGenerationRun.findMany({
      where: { presetId: preset.id },
      orderBy: { createdAt: 'desc' },
      take,
    });
    return {
      items: rows.map(
        (row: {
          id: string;
          presetId: string;
          status: string;
          sourcePostIdsJson: string;
          resultPostId: string | null;
          error: string | null;
          createdAt: Date;
          finishedAt: Date | null;
        }) => ({
          id: row.id,
          presetId: row.presetId,
          status: row.status,
          sourcePostIds: parseJsonStringArray(row.sourcePostIdsJson),
          resultPostId: row.resultPostId,
          error: row.error,
          createdAt: row.createdAt.toISOString(),
          finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
        }),
      ),
    };
  }

  async runPreset(
    presetId: string,
    options?: { postIds?: string[]; force?: boolean },
  ): Promise<
    | { ok: true; postId: string; published: boolean; runId: string }
    | { ok: false; error: string; runId?: string }
  > {
    const cabinetId = this.cabinetContext.getCabinetId();
    const preset = await (this.prisma as any).contentGenerationPreset.findFirst({
      where: { id: presetId.trim(), cabinetId },
    });
    if (!preset) return { ok: false, error: 'Пресет не найден' };

    const run = await (this.prisma as any).contentGenerationRun.create({
      data: { presetId: preset.id, status: 'running', sourcePostIdsJson: '[]' },
    });

    try {
      if (!options?.force) {
        const withinLimit = await this.checkDailyLimit(preset);
        if (!withinLimit) {
          await this.finishRun(run.id, {
            status: 'failed',
            error: 'Дневной лимит пресета исчерпан',
          });
          return { ok: false, error: 'Дневной лимит пресета исчерпан', runId: run.id };
        }
      }

      const sourcePosts = await this.resolveSourcePosts(preset, options?.postIds);
      if (sourcePosts.length === 0) {
        await this.finishRun(run.id, {
          status: 'failed',
          error: 'Нет подходящих исходных постов',
        });
        return { ok: false, error: 'Нет подходящих исходных постов', runId: run.id };
      }

      const outputKind =
        parseJsonStringArray(preset.sourceKindsJson)[0] ?? 'analysis';
      const generated = await this.transcript.generateChannelContent({
        outputKind,
        outputStyle: preset.outputStyle,
        instruction: preset.aiInstruction || undefined,
        sources: sourcePosts.map((p) => ({
          classification: p.classification,
          text: p.displayText,
        })),
        openrouterLogContext: { stage: 'content_generation', ingestId: preset.id },
      });
      if (!generated.ok || !generated.text) {
        await this.finishRun(run.id, {
          status: 'failed',
          error: generated.error ?? 'AI generation failed',
        });
        return {
          ok: false,
          error: generated.error ?? 'AI generation failed',
          runId: run.id,
        };
      }

      const created = await this.contentEditor.createGeneratedDraft({
        text: generated.text,
        classification: outputKind as 'analysis' | 'content' | 'news' | 'other',
        sourcePosts,
        presetId: preset.id,
      });
      if (!created.ok) {
        await this.finishRun(run.id, {
          status: 'failed',
          error: created.error,
          sourcePostIds: sourcePosts.map((p) => p.id),
        });
        return { ok: false, error: created.error, runId: run.id };
      }

      let published = false;
      if (preset.autoPublish) {
        const targetIds = parseJsonStringArray(preset.targetGroupIdsJson);
        const pub = await this.contentEditor.publishPost(created.postId, targetIds);
        published = pub.ok;
        if (!pub.ok) {
          await this.finishRun(run.id, {
            status: 'draft',
            sourcePostIds: sourcePosts.map((p) => p.id),
            resultPostId: created.postId,
            error: pub.error,
          });
          await (this.prisma as any).contentGenerationPreset.update({
            where: { id: preset.id },
            data: { lastRunAt: new Date() },
          });
          return {
            ok: true,
            postId: created.postId,
            published: false,
            runId: run.id,
          };
        }
        await (this.prisma as any).contentGenerationPreset.update({
          where: { id: preset.id },
          data: { lastRunAt: new Date(), lastPublishedAt: new Date() },
        });
      } else {
        await (this.prisma as any).contentGenerationPreset.update({
          where: { id: preset.id },
          data: { lastRunAt: new Date() },
        });
      }

      await this.finishRun(run.id, {
        status: published ? 'published' : 'draft',
        sourcePostIds: sourcePosts.map((p) => p.id),
        resultPostId: created.postId,
      });

      return {
        ok: true,
        postId: created.postId,
        published,
        runId: run.id,
      };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      await this.finishRun(run.id, { status: 'failed', error: err });
      return { ok: false, error: err, runId: run.id };
    }
  }

  private async finishRun(
    runId: string,
    params: {
      status: string;
      sourcePostIds?: string[];
      resultPostId?: string;
      error?: string;
    },
  ): Promise<void> {
    await (this.prisma as any).contentGenerationRun.update({
      where: { id: runId },
      data: {
        status: params.status,
        sourcePostIdsJson: stringifyJsonStringArray(params.sourcePostIds ?? []),
        resultPostId: params.resultPostId ?? null,
        error: params.error?.slice(0, 2000) ?? null,
        finishedAt: new Date(),
      },
    });
  }

  private async checkDailyLimit(preset: { id: string; dailyLimit: number }): Promise<boolean> {
    const { start, end } = appCalendarDayRange();
    const count = await (this.prisma as any).contentGenerationRun.count({
      where: {
        presetId: preset.id,
        createdAt: { gte: start, lt: end },
        status: { in: ['draft', 'published'] },
      },
    });
    return count < Math.max(1, preset.dailyLimit);
  }

  private async resolveSourcePosts(
    preset: {
      sourceKindsJson: string;
      sourceGroupIdsJson: string;
    },
    explicitPostIds?: string[],
  ): Promise<Array<{ id: string; classification: string; displayText: string; sourceChatId: string; sourceMessageId: string }>> {
    const cabinetId = this.cabinetContext.getCabinetId();
    if (explicitPostIds?.length) {
      const rows = await (this.prisma as any).tgUserbotContentPost.findMany({
        where: { cabinetId, id: { in: explicitPostIds } },
      });
      return rows.map(
        (row: {
          id: string;
          classification: string;
          originalText: string;
          editedText: string | null;
          sourceChatId: string;
          sourceMessageId: string;
        }) => ({
          id: row.id,
          classification: row.classification,
          displayText: row.editedText?.trim() || row.originalText,
          sourceChatId: row.sourceChatId,
          sourceMessageId: row.sourceMessageId,
        }),
      );
    }
    const kinds = parseJsonStringArray(preset.sourceKindsJson);
    const chatIds = parseJsonStringArray(preset.sourceGroupIdsJson);
    const where: Record<string, unknown> = {
      cabinetId,
      status: 'draft',
    };
    if (kinds.length > 0) {
      where.classification = { in: kinds };
    }
    if (chatIds.length > 0) {
      where.sourceChatId = { in: chatIds };
    }
    const rows = await (this.prisma as any).tgUserbotContentPost.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 3,
    });
    return rows.map(
      (row: {
        id: string;
        classification: string;
        originalText: string;
        editedText: string | null;
        sourceChatId: string;
        sourceMessageId: string;
      }) => ({
        id: row.id,
        classification: row.classification,
        displayText: row.editedText?.trim() || row.originalText,
        sourceChatId: row.sourceChatId,
        sourceMessageId: row.sourceMessageId,
      }),
    );
  }

  @Cron(process.env.CONTENT_GENERATION_CRON ?? '0 */1 * * *')
  async scheduledTick(): Promise<void> {
    const enabledRaw = process.env.CONTENT_GENERATION_ENABLED ?? 'true';
    if (!parseSettingsBool(enabledRaw, true)) {
      return;
    }
    if (this.schedulerInFlight) return;
    this.schedulerInFlight = true;
    try {
      const presets = await (this.prisma as any).contentGenerationPreset.findMany({
        where: { enabled: true, cabinet: { isActive: true, purpose: 'content' } },
      });
      for (const preset of presets) {
        if (!shouldRunCronNow(preset.scheduleCron)) {
          continue;
        }
        await this.cabinetContext.runWithCabinetAsync(preset.cabinetId, async () => {
          const result = await this.runPreset(preset.id);
          if (!result.ok) {
            this.logger.debug(
              `Content preset ${preset.id} scheduled run skipped/failed: ${result.error}`,
            );
          }
        });
      }
    } catch (e) {
      this.logger.warn(
        `Content generation scheduler failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      this.schedulerInFlight = false;
    }
  }
}
