import type { PrismaService } from '../../prisma/prisma.service';

export interface SanitizeOptions {
  maxStringLen?: number;
}

const DEFAULT_MAX = 12_000;

/**
 * Убирает огромные base64 из логов OpenRouter (image/audio), обрезает длинные строки.
 */
export function sanitizeForOpenRouterLog(
  value: unknown,
  opts: SanitizeOptions = {},
): unknown {
  const max = opts.maxStringLen ?? DEFAULT_MAX;
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === 'string') {
    if (value.startsWith('data:') && value.includes('base64')) {
      return `[data:…;base64 ${value.length} chars]`;
    }
    if (value.length > max) {
      return `${value.slice(0, max)}… [truncated ${value.length - max} chars]`;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => sanitizeForOpenRouterLog(v, opts));
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (k === 'image_url' && v && typeof v === 'object') {
        const url = (v as { url?: string }).url;
        if (typeof url === 'string' && url.startsWith('data:')) {
          out[k] = { url: `[data:…;base64 ${url.length} chars]` };
          continue;
        }
      }
      out[k] = sanitizeForOpenRouterLog(v, opts);
    }
    return out;
  }
  return value;
}

/** Ограничение размера JSON для SQLite. */
export function stringifyPayload(payload: unknown, maxTotal = 100_000): string {
  try {
    const s = JSON.stringify(payload);
    if (s.length <= maxTotal) return s;
    return `${s.slice(0, maxTotal)}… [json truncated ${s.length - maxTotal}]`;
  } catch {
    return '["non-serializable payload"]';
  }
}

/**
 * Удаление старых записей по дате — вместо COUNT(*) + N findMany.
 * Приоритет: шумные debug/info удаляются за последние 6 ч, остальные — за 24 ч.
 * Cron-задачи в AppLogService дополнительно чистят по своим расписаниям.
 */
export async function pruneOldLogs(
  prisma: PrismaService,
  _keepLast: number,
  noiseMessages: readonly string[] = [],
  workspaceId?: string | null,
): Promise<void> {
  const now = Date.now();
  const wsWhere =
    workspaceId === undefined ? {} : { workspaceId: workspaceId ?? null };

  // Шумные debug/info — удаляем старше 6 ч
  const noiseCutoff = new Date(now - 6 * 60 * 60 * 1000);
  if (noiseMessages.length > 0) {
    await prisma.appLog.deleteMany({
      where: {
        ...wsWhere,
        message: { in: [...noiseMessages] },
        createdAt: { lt: noiseCutoff },
      },
    });
  }
  await prisma.appLog.deleteMany({
    where: { ...wsWhere, level: 'debug', createdAt: { lt: noiseCutoff } },
  });

  // Всё остальное — удаляем старше 24 ч
  const regularCutoff = new Date(now - 24 * 60 * 60 * 1000);
  await prisma.appLog.deleteMany({
    where: { ...wsWhere, createdAt: { lt: regularCutoff } },
  });
}
