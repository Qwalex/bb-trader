import {
  addCalendarDaysInTimeZone,
  calendarDayKeyInTimeZone,
  resolveAppTimeZone,
  startOfAppCalendarDay,
} from '@repo/shared';

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
  const tz = resolveAppTimeZone();
  if (period === 'day') {
    return startOfAppCalendarDay(now, tz);
  }
  if (period === '3d') {
    return addCalendarDaysInTimeZone(startOfAppCalendarDay(now, tz), -2, tz);
  }
  if (period === 'week') {
    return addCalendarDaysInTimeZone(startOfAppCalendarDay(now, tz), -6, tz);
  }
  if (period === 'month') {
    const start = startOfAppCalendarDay(now, tz);
    const key = calendarDayKeyInTimeZone(start, tz);
    const parts = key.split('-').map(Number);
    const y = parts[0] ?? 1970;
    const m = parts[1] ?? 1;
    const d = parts[2] ?? 1;
    const probe = new Date(Date.UTC(y, m - 2, d, 12, 0, 0, 0));
    return startOfAppCalendarDay(probe, tz);
  }
  const start = startOfAppCalendarDay(now, tz);
  const key = calendarDayKeyInTimeZone(start, tz);
  const parts = key.split('-').map(Number);
  const y = parts[0] ?? 1970;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const probe = new Date(Date.UTC(y - 1, m - 1, d, 12, 0, 0, 0));
  return startOfAppCalendarDay(probe, tz);
}

export function bucketKeyByPeriod(d: Date, period: OpenrouterSpendPeriod): string {
  const tz = resolveAppTimeZone();
  if (period === 'day') {
    const day = calendarDayKeyInTimeZone(d, tz);
    const hour = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(d);
    return `${day}T${hour.padStart(2, '0')}:00`;
  }
  return calendarDayKeyInTimeZone(d, tz);
}
