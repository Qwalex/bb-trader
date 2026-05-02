import { Injectable } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { OrdersService } from '../../orders/orders.service';
import type { RecalcClosedPnlJobStatus, RecalcClosedPnlResult } from '../types/bybit.types';

@Injectable()
export class BybitRecalcService {
  private readonly recalcJobs = new Map<string, RecalcClosedPnlJobStatus>();
  private readonly recalcJobOrder: string[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
  ) {}

  async processRecalcClosedPnlQueueJob(
    params: {
      jobId: string;
      limit: number;
      dryRun: boolean;
    },
    ports: {
      recalcClosedSignalsPnl: (params: {
        limit?: number;
        dryRun?: boolean;
      }) => Promise<RecalcClosedPnlResult>;
    },
  ): Promise<void> {
    const current = this.recalcJobs.get(params.jobId);
    if (current) {
      current.status = 'running';
      current.startedAt = new Date().toISOString();
      current.error = undefined;
    }
    await this.prisma.recalcClosedPnlJob.update({
      where: { id: params.jobId },
      data: {
        status: 'running',
        startedAt: new Date(),
        error: null,
      },
    });

    try {
      const result = await ports.recalcClosedSignalsPnl({
        limit: params.limit,
        dryRun: params.dryRun,
      });
      if (current) {
        current.status = 'completed';
        current.result = result;
        current.finishedAt = new Date().toISOString();
        current.error = undefined;
      }
      await this.prisma.recalcClosedPnlJob.update({
        where: { id: params.jobId },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          resultJson: JSON.stringify(result),
          error: null,
        },
      });
    } catch (e) {
      const err = formatError(e);
      if (current) {
        current.status = 'failed';
        current.error = err;
        current.finishedAt = new Date().toISOString();
      }
      await this.prisma.recalcClosedPnlJob.update({
        where: { id: params.jobId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          error: err,
        },
      });
      throw e;
    }
  }

  async getRecalcClosedPnlJobStatus(
    jobId: string,
  ): Promise<RecalcClosedPnlJobStatus | null> {
    const memoryJob = this.recalcJobs.get(jobId);
    if (memoryJob) {
      return { ...memoryJob };
    }
    const row = await this.prisma.recalcClosedPnlJob.findUnique({
      where: { id: jobId },
    });
    if (!row) {
      return null;
    }
    let result: RecalcClosedPnlResult | undefined;
    if (row.resultJson) {
      try {
        result = JSON.parse(row.resultJson) as RecalcClosedPnlResult;
      } catch {
        result = undefined;
      }
    }
    return {
      jobId: row.id,
      status: row.status as RecalcClosedPnlJobStatus['status'],
      dryRun: row.dryRun,
      limit: row.limit,
      createdAt: row.createdAt.toISOString(),
      startedAt: row.startedAt?.toISOString(),
      finishedAt: row.finishedAt?.toISOString(),
      result,
      error: row.error ?? undefined,
    };
  }

  registerRecalcJob(job: RecalcClosedPnlJobStatus): void {
    this.recalcJobs.set(job.jobId, job);
    this.recalcJobOrder.push(job.jobId);
    this.pruneOldRecalcJobs();
  }

  private pruneOldRecalcJobs(): void {
    const MAX = 50;
    while (this.recalcJobOrder.length > MAX) {
      const oldId = this.recalcJobOrder.shift();
      if (oldId) {
        this.recalcJobs.delete(oldId);
      }
    }
  }

  async recalcClosedSignalsPnl(
    params: {
      limit?: number;
      dryRun?: boolean;
    } | undefined,
    ports: {
      getClient: () => Promise<RestClientV5 | null>;
      buildClosedPnlWindow: (
        signalCreatedAt: Date,
        signalClosedAt?: Date | null,
      ) => { startTime: number; endTime: number };
      fetchClosedPnlRowsForSymbol: (
        client: RestClientV5,
        symbol: string,
        startTime: number,
        endTime: number,
      ) => Promise<unknown[]>;
      sumClosedPnlForSignal: (
        rows: unknown[],
        ourIds: Set<string>,
        direction: string,
        signalCreatedAt: Date,
        signalClosedAt?: Date | null,
      ) => { totalPnl: number; hadParsedPnl: boolean };
      estimateClosedPnlFromExecutions: (params: {
        client: RestClientV5;
        symbol: string;
        direction: string;
        createdAt: Date;
        closedAt?: Date | null;
      }) => Promise<{ netPnl: number } | undefined>;
    },
  ): Promise<RecalcClosedPnlResult> {
    const dryRun = params?.dryRun ?? true;
    const limit = params?.limit ?? 200;
    const client = await ports.getClient();
    if (!client) {
      return {
        ok: false,
        dryRun,
        scanned: 0,
        updated: 0,
        unchanged: 0,
        skippedNoBybitOrders: 0,
        skippedNoClosedPnl: 0,
        errors: [
          {
            signalId: '-',
            error: 'Нет подключенных ключей Bybit. Пересчет closed PnL невозможен.',
          },
        ],
      };
    }

    const closed = await this.orders.listClosedSignalsForPnlRecalc({ limit });
    let updated = 0;
    let unchanged = 0;
    let skippedNoBybitOrders = 0;
    let skippedNoClosedPnl = 0;
    const errors: { signalId: string; error: string }[] = [];

    for (const sig of closed) {
      const ourIds = new Set<string>(
        sig.orders
          .map((o) => (o.bybitOrderId ? String(o.bybitOrderId) : ''))
          .filter((id): id is string => id.length > 0),
      );
      if (ourIds.size === 0) {
        skippedNoBybitOrders += 1;
        continue;
      }

      try {
        const symbol = normalizeTradingPair(sig.pair);
        const requestWindow = ports.buildClosedPnlWindow(sig.createdAt, sig.closedAt);
        const rows = await ports.fetchClosedPnlRowsForSymbol(
          client,
          symbol,
          requestWindow.startTime,
          requestWindow.endTime,
        );
        const { totalPnl, hadParsedPnl } = ports.sumClosedPnlForSignal(
          rows,
          ourIds,
          sig.direction,
          sig.createdAt,
          sig.closedAt,
        );

        let nextPnl: number | undefined;
        if (hadParsedPnl) {
          nextPnl = totalPnl;
        } else {
          const fallback = await ports.estimateClosedPnlFromExecutions({
            client,
            symbol,
            direction: sig.direction,
            createdAt: sig.createdAt,
            closedAt: sig.closedAt,
          });
          nextPnl = fallback?.netPnl;
        }
        if (nextPnl === undefined) {
          skippedNoClosedPnl += 1;
          continue;
        }

        const nextStatus = nextPnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
        const prevPnl = sig.realizedPnl;
        const pnlChanged =
          prevPnl === null ||
          prevPnl === undefined ||
          Math.abs(prevPnl - nextPnl) > 1e-9;
        const statusChanged = sig.status !== nextStatus;

        if (!pnlChanged && !statusChanged) {
          unchanged += 1;
          continue;
        }

        if (!dryRun) {
          await this.orders.updateSignalStatus(sig.id, {
            status: nextStatus,
            realizedPnl: nextPnl,
            closedAt: sig.closedAt ?? new Date(),
          });
        }
        updated += 1;
      } catch (e) {
        errors.push({ signalId: sig.id, error: formatError(e) });
      }
    }

    if (!dryRun) {
      void this.appLog.append('info', 'bybit', 'recalc closed pnl completed', {
        scanned: closed.length,
        updated,
        unchanged,
        skippedNoBybitOrders,
        skippedNoClosedPnl,
        errors: errors.length,
      });
    }

    return {
      ok: errors.length === 0,
      dryRun,
      scanned: closed.length,
      updated,
      unchanged,
      skippedNoBybitOrders,
      skippedNoClosedPnl,
      errors,
    };
  }
}
