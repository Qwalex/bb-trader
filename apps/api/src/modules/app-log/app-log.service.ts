import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';

import { pruneOldLogs, stringifyPayload } from './log-sanitize';

const PRUNE_THROTTLE_MS = 5 * 60_000;

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogCategory =
  | 'openrouter'
  | 'telegram'
  | 'bybit'
  | 'orders'
  | 'system';

const MAX_ROWS = 100_000;
const NOISE_MESSAGES = [
  'poll: stale signal kept because exchange exposure still exists',
  'poll: reconcile stale pass started',
  'Userbot: duplicate ingest skipped',
] as const;

/** Не пишем в БД (страница /logs): высокочастотный отладочный шум. */
const SKIP_DB_APPEND_MESSAGES = new Set<string>([
  ...NOISE_MESSAGES,
  'poll: stale reconcile skipped because pair is suspended',
  'poll: stale reconcile postponed until clean state repeats',
  'poll: no stale signals found to reconcile for clean exchange side',
  'poll: no live position for signal direction before close candidate evaluation',
  'immediate stale blocker cleanup skipped because exchange exposure exists',
  'stale reconcile suspended',
  'stale reconcile resumed',
  'stale reconcile suspension decremented',
  'Userbot: pair/direction transition started',
  'Userbot: pair/direction transition finished',
  'Userbot: pair/direction transition decremented',
  'Userbot: close cooldown set',
  'Reentry: resolved root source message',
  'Close: resolved root source message',
  'Userbot: released signal hash',
  'Userbot: processing started',
  'Userbot: parse started',
]);

function shouldSkipDbAppend(
  level: LogLevel,
  message: string,
  opts: { logNoisyEvents: boolean },
): boolean {
  const skipAllDebug =
    process.env.APPLOG_DB_SKIP_DEBUG === '1' ||
    String(process.env.APPLOG_DB_SKIP_DEBUG ?? '')
      .toLowerCase()
      .trim() === 'true';
  if (skipAllDebug && level === 'debug') {
    return true;
  }
  if (opts.logNoisyEvents) {
    return false;
  }
  return SKIP_DB_APPEND_MESSAGES.has(message);
}

function parseLogNoisySetting(raw: string | undefined): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

@Injectable()
export class AppLogService {
  private static readonly LOG_NOISY_POLICY_TTL_MS = 10_000;

  private readonly logger = new Logger(AppLogService.name);
  private dbFullMuteUntilTs = 0;
  private dbFullLastErrorTs = 0;
  private lastPruneTs = 0;
  private logNoisyPolicyCache = new Map<string, { expiresAt: number; value: boolean }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private normalizeWorkspaceId(workspaceId?: string | null): string | null {
    const explicit = workspaceId?.trim();
    if (explicit) {
      return explicit;
    }
    const bootstrap = process.env.BOOTSTRAP_WORKSPACE_ID?.trim();
    return bootstrap || null;
  }

  private async resolveLogNoisyEventsEnabled(workspaceId?: string | null): Promise<boolean> {
    const ws = this.normalizeWorkspaceId(workspaceId);
    const cacheKey = ws ?? '__global__';
    const now = Date.now();
    const cached = this.logNoisyPolicyCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.value;
    }
    let raw: string | undefined;
    try {
      raw = await this.settings.get('APPLOG_LOG_NOISY_EVENTS', ws);
    } catch {
      raw = undefined;
    }
    const value = parseLogNoisySetting(raw);
    this.logNoisyPolicyCache.set(cacheKey, {
      value,
      expiresAt: now + AppLogService.LOG_NOISY_POLICY_TTL_MS,
    });
    return value;
  }

  private isDbFullError(e: unknown): boolean {
    const msg = String(e ?? '').toLowerCase();
    return (
      msg.includes('database or disk is full') ||
      msg.includes('sqliteerror') && msg.includes('extended_code: 13')
    );
  }

  private shouldMuteDbWrites(): boolean {
    return Date.now() < this.dbFullMuteUntilTs;
  }

  private activateDbFullMute(errText: string): void {
    const now = Date.now();
    // При переполнении диска/БД глушим запись логов на 5 минут,
    // чтобы не усиливать проблему лавиной повторных write.
    this.dbFullMuteUntilTs = now + 5 * 60_000;
    if (now - this.dbFullLastErrorTs > 60_000) {
      this.dbFullLastErrorTs = now;
      this.logger.error(
        `AppLog write muted for 5m (SQLite full): ${errText}`,
      );
    }
  }

  async append(
    level: LogLevel,
    category: LogCategory,
    message: string,
    payload?: unknown,
    options?: { workspaceId?: string | null },
  ): Promise<void> {
    const workspaceId = this.normalizeWorkspaceId(options?.workspaceId);
    const logNoisyEvents = await this.resolveLogNoisyEventsEnabled(workspaceId);
    if (shouldSkipDbAppend(level, message, { logNoisyEvents })) {
      return;
    }
    if (this.shouldMuteDbWrites()) {
      return;
    }
    try {
      const payloadStr =
        payload === undefined ? null : stringifyPayload(payload);
      await this.prisma.appLog.create({
        data: {
          ...(workspaceId ? { workspaceId } : {}),
          level,
          category,
          message,
          payload: payloadStr,
        },
      });
      const now = Date.now();
      if (now - this.lastPruneTs >= PRUNE_THROTTLE_MS) {
        this.lastPruneTs = now;
        void pruneOldLogs(this.prisma, MAX_ROWS, NOISE_MESSAGES, workspaceId).catch((e) =>
          this.logger.warn(`pruneOldLogs: ${String(e)}`),
        );
      }
    } catch (e) {
      const errText = String(e);
      if (this.isDbFullError(e)) {
        this.activateDbFullMute(errText);
        return;
      }
      this.logger.error(`append log failed: ${errText}`);
    }
  }

  async list(options: {
    limit?: number;
    category?: string;
    workspaceId?: string | null;
  }): Promise<
    {
      id: string;
      level: string;
      category: string;
      message: string;
      payload: string | null;
      createdAt: Date;
    }[]
  > {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
    const where = {
      ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
      ...(options.category && options.category !== 'all' ? { category: options.category } : {}),
    };
    return this.prisma.appLog.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async deleteOldNoiseLogs(): Promise<void> {
    if (this.shouldMuteDbWrites()) {
      return;
    }
    const olderThan = new Date(Date.now() - 30 * 60 * 1000);
    try {
      const buckets = await this.prisma.appLog.findMany({
        select: { workspaceId: true },
        distinct: ['workspaceId'],
      });
      let totalDeleted = 0;
      for (const bucket of buckets) {
        const result = await this.prisma.appLog.deleteMany({
          where: {
            workspaceId: bucket.workspaceId ?? null,
            message: { in: [...NOISE_MESSAGES] },
            createdAt: { lt: olderThan },
          },
        });
        totalDeleted += result.count;
      }
      if (totalDeleted > 0) {
        this.logger.log(`deleted old noise logs: ${totalDeleted}`);
      }
    } catch (e) {
      if (this.isDbFullError(e)) {
        this.activateDbFullMute(String(e));
        return;
      }
      this.logger.warn(`deleteOldNoiseLogs failed: ${String(e)}`);
    }
  }

  @Cron('0 0 0 */3 * *')
  async deleteOldRegularLogs(): Promise<void> {
    if (this.shouldMuteDbWrites()) {
      return;
    }
    const olderThan = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    try {
      const buckets = await this.prisma.appLog.findMany({
        select: { workspaceId: true },
        distinct: ['workspaceId'],
      });
      let totalDeleted = 0;
      for (const bucket of buckets) {
        const result = await this.prisma.appLog.deleteMany({
          where: {
            workspaceId: bucket.workspaceId ?? null,
            message: { notIn: [...NOISE_MESSAGES] },
            createdAt: { lt: olderThan },
          },
        });
        totalDeleted += result.count;
      }
      if (totalDeleted > 0) {
        this.logger.log(`deleted old regular logs: ${totalDeleted}`);
      }
    } catch (e) {
      if (this.isDbFullError(e)) {
        this.activateDbFullMute(String(e));
        return;
      }
      this.logger.warn(`deleteOldRegularLogs failed: ${String(e)}`);
    }
  }
}
