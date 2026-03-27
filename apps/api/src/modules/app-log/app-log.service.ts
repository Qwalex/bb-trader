import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';

import { pruneOldLogs, stringifyPayload } from './log-sanitize';

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

@Injectable()
export class AppLogService {
  private readonly logger = new Logger(AppLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  async append(
    level: LogLevel,
    category: LogCategory,
    message: string,
    payload?: unknown,
  ): Promise<void> {
    try {
      const payloadStr =
        payload === undefined ? null : stringifyPayload(payload);
      await this.prisma.appLog.create({
        data: {
          level,
          category,
          message,
          payload: payloadStr,
        },
      });
      void pruneOldLogs(this.prisma, MAX_ROWS).catch((e) =>
        this.logger.warn(`pruneOldLogs: ${String(e)}`),
      );
    } catch (e) {
      this.logger.error(`append log failed: ${String(e)}`);
    }
  }

  async list(options: {
    limit?: number;
    category?: string;
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
    const where =
      options.category && options.category !== 'all'
        ? { category: options.category }
        : undefined;
    return this.prisma.appLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async deleteOldNoiseLogs(): Promise<void> {
    const olderThan = new Date(Date.now() - 30 * 60 * 1000);
    try {
      const result = await this.prisma.appLog.deleteMany({
        where: {
          message: { in: [...NOISE_MESSAGES] },
          createdAt: { lt: olderThan },
        },
      });
      if (result.count > 0) {
        this.logger.log(`deleted old noise logs: ${result.count}`);
      }
    } catch (e) {
      this.logger.warn(`deleteOldNoiseLogs failed: ${String(e)}`);
    }
  }

  @Cron('0 0 0 */3 * *')
  async deleteOldRegularLogs(): Promise<void> {
    const olderThan = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    try {
      const result = await this.prisma.appLog.deleteMany({
        where: {
          message: { notIn: [...NOISE_MESSAGES] },
          createdAt: { lt: olderThan },
        },
      });
      if (result.count > 0) {
        this.logger.log(`deleted old regular logs: ${result.count}`);
      }
    } catch (e) {
      this.logger.warn(`deleteOldRegularLogs failed: ${String(e)}`);
    }
  }
}
