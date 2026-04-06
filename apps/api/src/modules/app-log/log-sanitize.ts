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

/** Удаление старых записей при переполнении. */
export async function pruneOldLogs(
  prisma: PrismaService,
  keepLast: number,
  noiseMessages: readonly string[] = [],
): Promise<void> {
  const count = await prisma.appLog.count();
  if (count <= keepLast) {
    return;
  }
  const excess = count - keepLast;
  let remaining = excess;

  const deleteOldestWhere = async (
    where: Record<string, unknown>,
    limit: number,
  ): Promise<number> => {
    if (limit <= 0) return 0;
    const rows = await prisma.appLog.findMany({
      where: where as any,
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: { id: true },
    });
    const ids = rows.map((r) => r.id);
    if (!ids.length) return 0;
    const res = await prisma.appLog.deleteMany({ where: { id: { in: ids } } });
    return res.count ?? ids.length;
  };

  // Приоритет удаления: шумные debug → все debug → info noise → остальные info/system → warn → error (последними).
  // Это защищает важные warn/error от вытеснения большим потоком debug/info.
  remaining -= await deleteOldestWhere(
    noiseMessages.length
      ? { level: 'debug', message: { in: [...noiseMessages] } }
      : { level: 'debug' },
    remaining,
  );
  remaining -= await deleteOldestWhere(
    { level: 'debug' },
    remaining,
  );
  if (noiseMessages.length) {
    remaining -= await deleteOldestWhere(
      { level: 'info', message: { in: [...noiseMessages] } },
      remaining,
    );
  }
  // Остальной info (bybit, openrouter, …) вытесняем раньше, чем vk — чтобы диагностика Callback API не пропадала в потоке.
  remaining -= await deleteOldestWhere(
    { level: 'info', category: { not: 'vk' } },
    remaining,
  );
  remaining -= await deleteOldestWhere(
    { level: 'info', category: 'vk' },
    remaining,
  );
  remaining -= await deleteOldestWhere(
    { level: 'warn' },
    remaining,
  );
  remaining -= await deleteOldestWhere(
    { level: 'error' },
    remaining,
  );

  // На всякий случай: если что-то осталось (неизвестные level), удаляем самые старые вообще.
  if (remaining > 0) {
    await deleteOldestWhere({}, remaining);
  }
}
