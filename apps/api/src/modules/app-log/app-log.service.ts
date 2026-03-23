import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

import { pruneOldLogs, stringifyPayload } from './log-sanitize';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogCategory =
  | 'openrouter'
  | 'telegram'
  | 'bybit'
  | 'orders'
  | 'system';

const MAX_ROWS = 12_000;

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
}
