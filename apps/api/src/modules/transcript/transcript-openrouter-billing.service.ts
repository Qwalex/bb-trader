import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { AppLogService } from '../app-log/app-log.service';
import { SettingsService } from '../settings/settings.service';
import {
  OPENROUTER_APP_TITLE,
  OPENROUTER_CREDITS_URL,
  OPENROUTER_GENERATION_LOOKUP_DELAY_MS,
  OPENROUTER_GENERATION_LOOKUP_MAX_ATTEMPTS,
  OPENROUTER_GENERATION_URL,
  OPENROUTER_GENERATION_WORKER_BATCH,
  OPENROUTER_SITE_URL,
} from './transcript.constants';
import type { OpenRouterLogContext } from './transcript.types';
import {
  formatOpenRouterError,
  parseNumberOrNull,
} from './transcript-openrouter-parse.util';

@Injectable()
export class TranscriptOpenRouterBillingService {
  constructor(
    private readonly settings: SettingsService,
    private readonly appLog: AppLogService,
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  async getOpenrouterBalance(): Promise<{
    ok: boolean;
    balanceUsd: number | null;
    totalCreditsUsd: number | null;
    totalUsageUsd: number | null;
    error?: string;
  }> {
    const apiKey = (await this.settings.get('OPENROUTER_API_KEY'))?.trim();
    if (!apiKey) {
      return {
        ok: false,
        balanceUsd: null,
        totalCreditsUsd: null,
        totalUsageUsd: null,
        error: 'OPENROUTER_API_KEY is not configured',
      };
    }
    const parseNum = (value: unknown): number | null => {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    };
    try {
      const res = await fetch(OPENROUTER_CREDITS_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': OPENROUTER_SITE_URL,
          'X-Title': OPENROUTER_APP_TITLE,
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 400)}`);
      }
      const json = (await res.json()) as {
        data?: {
          total_credits?: unknown;
          total_usage?: unknown;
        };
      };
      const totalCreditsUsd = parseNum(json?.data?.total_credits);
      const totalUsageUsd = parseNum(json?.data?.total_usage);
      const balanceUsd =
        totalCreditsUsd != null && totalUsageUsd != null
          ? Number((totalCreditsUsd - totalUsageUsd).toFixed(8))
          : null;
      return {
        ok: true,
        balanceUsd,
        totalCreditsUsd,
        totalUsageUsd,
      };
    } catch (e) {
      return {
        ok: false,
        balanceUsd: null,
        totalCreditsUsd: null,
        totalUsageUsd: null,
        error: formatOpenRouterError(e),
      };
    }
  }

  async fetchGenerationCostUsd(
    apiKey: string,
    generationId: string | undefined,
    meta?: { operation?: string; logContext?: OpenRouterLogContext },
    options?: { maxAttempts?: number; delayMs?: number },
  ): Promise<number | null> {
    const id = String(generationId ?? '').trim();
    if (!id) return null;
    const maxAttempts = Math.max(1, options?.maxAttempts ?? OPENROUTER_GENERATION_LOOKUP_MAX_ATTEMPTS);
    const delayMs = Math.max(0, options?.delayMs ?? OPENROUTER_GENERATION_LOOKUP_DELAY_MS);
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch(
          `${OPENROUTER_GENERATION_URL}?id=${encodeURIComponent(id)}`,
          {
            method: 'GET',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
          },
        );
        if (!res.ok) {
          const shouldRetry =
            (res.status === 404 || res.status === 429 || res.status >= 500) &&
            attempt < maxAttempts;
          if (!shouldRetry) {
            await this.appLog.append('error', 'openrouter', '↔ generation lookup failed', {
              operation: meta?.operation,
              generationId: id,
              attempt,
              maxAttempts,
              httpStatus: res.status,
              statusText: res.statusText,
              logContext: meta?.logContext,
            });
          }
          if (shouldRetry) {
            await new Promise((resolve) =>
              setTimeout(resolve, delayMs * attempt),
            );
            continue;
          }
          return null;
        }
        const json = (await res.json()) as {
          data?: { total_cost?: unknown; usage?: unknown; cost?: unknown };
        };
        const data = json.data ?? {};
        const cost =
          parseNumberOrNull(data.total_cost) ??
          parseNumberOrNull(data.cost) ??
          parseNumberOrNull(data.usage);
        if (cost != null) {
          await this.appLog.append('info', 'openrouter', '↔ generation lookup completed', {
            operation: meta?.operation,
            generationId: id,
            attempt,
            maxAttempts,
            httpStatus: res.status,
            resolvedCostUsd: cost,
            logContext: meta?.logContext,
          });
        }
        return cost != null && cost >= 0 ? cost : null;
      } catch (e) {
        const shouldRetry = attempt < maxAttempts;
        if (!shouldRetry) {
          await this.appLog.append('error', 'openrouter', '↔ generation lookup exception', {
            operation: meta?.operation,
            generationId: id,
            attempt,
            maxAttempts,
            error: formatOpenRouterError(e),
            logContext: meta?.logContext,
          });
        }
        if (shouldRetry) {
          await new Promise((resolve) =>
            setTimeout(resolve, delayMs * attempt),
          );
          continue;
        }
        return null;
      }
    }
    return null;
  }

  async upsertGenerationCostEntry(params: {
    generationId: string;
    operation?: string;
    logContext?: OpenRouterLogContext;
    costUsd?: number | null;
    status?: 'pending' | 'resolved' | 'failed';
    attemptsDelta?: number;
    nextRetryAt?: Date | null;
    lastError?: string | null;
  }): Promise<void> {
    const cabinetId = this.cabinetContext.getCabinetId();
    const id = params.generationId.trim();
    if (!id) return;
    const existing = await this.prisma.openrouterGenerationCost.findUnique({
      where: { generationId: id },
      select: { attempts: true },
    });
    const nextAttempts =
      (existing?.attempts ?? 0) + Math.max(0, params.attemptsDelta ?? 0);
    await this.prisma.openrouterGenerationCost.upsert({
      where: { generationId: id },
      create: {
        cabinetId,
        generationId: id,
        operation: params.operation ?? null,
        chatId: params.logContext?.chatId ?? null,
        source: params.logContext?.source ?? null,
        ingestId: params.logContext?.ingestId ?? null,
        costUsd: params.costUsd ?? null,
        status: params.status ?? (params.costUsd != null ? 'resolved' : 'pending'),
        attempts: nextAttempts,
        nextRetryAt: params.nextRetryAt ?? null,
        lastError: params.lastError ?? null,
      },
      update: {
        ...(cabinetId ? { cabinetId } : {}),
        operation: params.operation ?? undefined,
        chatId: params.logContext?.chatId ?? undefined,
        source: params.logContext?.source ?? undefined,
        ingestId: params.logContext?.ingestId ?? undefined,
        costUsd: params.costUsd ?? undefined,
        status: params.status ?? undefined,
        attempts: nextAttempts,
        nextRetryAt: params.nextRetryAt ?? undefined,
        lastError: params.lastError ?? undefined,
      },
    });
  }

  async backfillOpenrouterGenerationCosts(): Promise<void> {
    const apiKey = (await this.settings.get('OPENROUTER_API_KEY'))?.trim();
    if (!apiKey) return;
    const now = new Date();
    const pending = await this.prisma.openrouterGenerationCost.findMany({
      where: {
        status: 'pending',
        OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
      },
      orderBy: { createdAt: 'asc' },
      take: OPENROUTER_GENERATION_WORKER_BATCH,
    });
    for (const row of pending) {
      const generationId = String(row.generationId ?? '').trim();
      if (!generationId) {
        continue;
      }
      const cost = await this.fetchGenerationCostUsd(
        apiKey,
        generationId,
        {
          operation: typeof row.operation === 'string' ? row.operation : undefined,
          logContext: {
            chatId: typeof row.chatId === 'string' ? row.chatId : undefined,
            source: typeof row.source === 'string' ? row.source : undefined,
            ingestId: typeof row.ingestId === 'string' ? row.ingestId : undefined,
            stage: 'generation-worker',
          },
        },
        { maxAttempts: 1, delayMs: 0 },
      );
      if (cost != null) {
        await this.upsertGenerationCostEntry({
          generationId,
          costUsd: cost,
          status: 'resolved',
          attemptsDelta: 1,
          nextRetryAt: null,
          lastError: null,
        });
        continue;
      }
      const attempts = Number(row.attempts ?? 0) + 1;
      const delay = Math.min(60 * 60_000, 15_000 * 2 ** Math.min(attempts, 8));
      await this.upsertGenerationCostEntry({
        generationId,
        status: attempts >= 30 ? 'failed' : 'pending',
        attemptsDelta: 1,
        nextRetryAt: attempts >= 30 ? null : new Date(Date.now() + delay),
        lastError: 'generation_cost_unavailable',
      });
    }
  }
}
