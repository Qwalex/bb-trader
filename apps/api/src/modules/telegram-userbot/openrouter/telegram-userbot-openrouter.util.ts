import type { OpenrouterSpendPeriod } from '../telegram-userbot.types';

export function parseOpenrouterNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function extractOpenrouterCostUsd(
  payloadRaw: string | null,
): { chatId: string; costUsd: number } | null {
  if (!payloadRaw) return null;
  try {
    const payload = JSON.parse(payloadRaw) as {
      responseMeta?: {
        model?: unknown;
        cost?: unknown;
        costUsd?: unknown;
        generationCostUsd?: unknown;
        totalCost?: unknown;
        total_cost?: unknown;
        usage?: {
          cost?: unknown;
          costUsd?: unknown;
          totalCost?: unknown;
          total_cost?: unknown;
          promptTokens?: unknown;
          completionTokens?: unknown;
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
        };
      };
      openrouterResponse?: {
        usage?: {
          cost?: unknown;
          totalCost?: unknown;
          total_cost?: unknown;
          promptTokens?: unknown;
          completionTokens?: unknown;
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
        };
        model?: unknown;
      };
      logContext?: { chatId?: unknown };
    };
    const chatId = String(payload.logContext?.chatId ?? '').trim();
    if (!chatId) return null;
    const meta = payload.responseMeta ?? {};
    const usage = meta.usage ?? {};
    const fullResponse = payload.openrouterResponse ?? {};
    const fullUsage = fullResponse.usage ?? {};
    const candidate =
      parseOpenrouterNumberOrNull(meta.costUsd) ??
      parseOpenrouterNumberOrNull(meta.generationCostUsd) ??
      parseOpenrouterNumberOrNull(meta.cost) ??
      parseOpenrouterNumberOrNull(meta.totalCost) ??
      parseOpenrouterNumberOrNull(meta.total_cost) ??
      parseOpenrouterNumberOrNull(usage.costUsd) ??
      parseOpenrouterNumberOrNull(usage.cost) ??
      parseOpenrouterNumberOrNull(usage.totalCost) ??
      parseOpenrouterNumberOrNull(usage.total_cost) ??
      parseOpenrouterNumberOrNull(fullUsage.cost) ??
      parseOpenrouterNumberOrNull(fullUsage.totalCost) ??
      parseOpenrouterNumberOrNull(fullUsage.total_cost);
    if (candidate == null || candidate < 0) return null;
    return { chatId, costUsd: candidate };
  } catch {
    return null;
  }
}

export function resolveOpenrouterPeriodStart(
  period: OpenrouterSpendPeriod,
  now = new Date(),
): Date {
  const start = new Date(now);
  if (period === 'day') {
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === '3d') {
    start.setDate(start.getDate() - 2);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === 'week') {
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  if (period === 'month') {
    start.setMonth(start.getMonth() - 1);
    return start;
  }
  start.setFullYear(start.getFullYear() - 1);
  return start;
}

export function bucketKeyByPeriod(d: Date, period: OpenrouterSpendPeriod): string {
  if (period === 'day') {
    return new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      0,
      0,
      0,
    ).toISOString();
  }
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0).toISOString();
}
