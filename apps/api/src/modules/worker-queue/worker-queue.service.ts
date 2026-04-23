import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { BybitService } from '../bybit/bybit.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';
import {
  WORK_QUEUE_EXECUTION,
  WORK_QUEUE_NOTIFICATIONS,
  WORK_QUEUE_RECONCILE,
  type WorkQueueName,
  type WorkQueuePayload,
} from './worker-queue.types';

@Injectable()
export class WorkerQueueService implements OnModuleInit {
  private readonly logger = new Logger(WorkerQueueService.name);
  private readonly pollMs = 900;
  private readonly maxAttempts = 8;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
  ) {}

  onModuleInit(): void {
    if (process.env.WORKER_QUEUE_ENABLED?.trim() === 'false') {
      this.logger.warn('worker queue disabled via WORKER_QUEUE_ENABLED=false');
      return;
    }
    setTimeout(() => {
      this.running = true;
      void this.loop();
    }, 200);
  }

  async enqueue(
    queue: WorkQueueName,
    jobKey: string,
    payload: WorkQueuePayload,
    delayMs = 0,
  ): Promise<void> {
    const runAfter = new Date(Date.now() + Math.max(0, delayMs));
    await this.prisma.workerQueueJob.upsert({
      where: { jobKey },
      create: {
        queue,
        jobKey,
        payloadJson: JSON.stringify(payload),
        status: 'pending',
        runAfter,
      },
      update: {
        payloadJson: JSON.stringify(payload),
        status: 'pending',
        runAfter,
        error: null,
        lockedAt: null,
        finishedAt: null,
      },
    });
  }

  async enqueuePollSweep(reason = 'interval'): Promise<void> {
    const cabinets = await this.cabinets.listCabinets();
    for (const cabinet of cabinets) {
      await this.enqueue(
        WORK_QUEUE_RECONCILE,
        `poll-cabinet:${cabinet.id}`,
        {
          type: 'poll-cabinet',
          cabinetId: cabinet.id,
          reason,
        },
        0,
      );
    }
  }

  async enqueueWsReconcile(cabinetId: string, symbol?: string): Promise<void> {
    await this.enqueue(
      WORK_QUEUE_RECONCILE,
      `ws-reconcile:${cabinetId}:${String(symbol ?? '').trim().toUpperCase() || 'all'}`,
      {
        type: 'bybit-ws-reconcile',
        cabinetId,
        symbol: symbol?.trim() || undefined,
      },
      150,
    );
  }

  async enqueueRecalcJob(params: {
    jobId: string;
    dryRun: boolean;
    limit: number;
    cabinetId?: string | null;
  }): Promise<void> {
    await this.enqueue(
      WORK_QUEUE_EXECUTION,
      `recalc-closed-pnl:${params.jobId}`,
      {
        type: 'recalc-closed-pnl',
        jobId: params.jobId,
        dryRun: params.dryRun,
        limit: params.limit,
        cabinetId: params.cabinetId ?? null,
      },
      0,
    );
  }

  async enqueueTradeCancelledNotification(params: {
    cabinetId?: string | null;
    signalIds: string[];
    reason: string;
  }): Promise<void> {
    if (params.signalIds.length === 0) return;
    const key = `notify-cancelled:${params.cabinetId ?? 'default'}:${params.signalIds.join(',')}`;
    await this.enqueue(
      WORK_QUEUE_NOTIFICATIONS,
      key,
      {
        type: 'notify-trade-cancelled',
        cabinetId: params.cabinetId ?? null,
        signalIds: params.signalIds,
        reason: params.reason,
      },
      0,
    );
  }

  async getStats(): Promise<{
    execution: Record<string, number>;
    reconcile: Record<string, number>;
    notifications: Record<string, number>;
  }> {
    const rows = await this.prisma.workerQueueJob.groupBy({
      by: ['queue', 'status'],
      _count: { _all: true },
    });
    const result = {
      execution: { pending: 0, running: 0, completed: 0, failed: 0 },
      reconcile: { pending: 0, running: 0, completed: 0, failed: 0 },
      notifications: { pending: 0, running: 0, completed: 0, failed: 0 },
    };
    for (const row of rows) {
      const target =
        row.queue === WORK_QUEUE_EXECUTION
          ? result.execution
          : row.queue === WORK_QUEUE_NOTIFICATIONS
            ? result.notifications
            : result.reconcile;
      target[row.status] = row._count._all;
    }
    return result;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        await Promise.all([
          this.runQueue(WORK_QUEUE_EXECUTION),
          this.runQueue(WORK_QUEUE_RECONCILE),
          this.runQueue(WORK_QUEUE_NOTIFICATIONS),
        ]);
      } catch (e) {
        this.logger.warn(`worker loop: ${formatError(e)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  private async runQueue(queue: WorkQueueName): Promise<void> {
    const job = await this.prisma.workerQueueJob.findFirst({
      where: {
        queue,
        status: 'pending',
        runAfter: { lte: new Date() },
      },
      orderBy: [{ runAfter: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        payloadJson: true,
        attempts: true,
      },
    });
    if (!job) return;
    const lock = await this.prisma.workerQueueJob.updateMany({
      where: { id: job.id, status: 'pending' },
      data: {
        status: 'running',
        lockedAt: new Date(),
      },
    });
    if (lock.count === 0) return;
    try {
      const payload = JSON.parse(job.payloadJson) as WorkQueuePayload;
      await this.handlePayload(payload);
      await this.prisma.workerQueueJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          error: null,
        },
      });
    } catch (e) {
      const attempts = job.attempts + 1;
      const finalFailure = attempts >= this.maxAttempts;
      await this.prisma.workerQueueJob.update({
        where: { id: job.id },
        data: finalFailure
          ? {
              status: 'failed',
              attempts,
              error: formatError(e),
              finishedAt: new Date(),
            }
          : {
              status: 'pending',
              attempts,
              error: formatError(e),
              runAfter: new Date(Date.now() + attempts * 1_500),
            },
      });
      if (finalFailure) {
        this.logger.error(`queue job ${job.id} failed: ${formatError(e)}`);
      }
    }
  }

  private async handlePayload(payload: WorkQueuePayload): Promise<void> {
    if (payload.type === 'poll-cabinet') {
      await this.cabinetContext.runWithCabinet(payload.cabinetId, async () => {
        await this.bybit.pollOpenOrders();
      });
      return;
    }
    if (payload.type === 'bybit-ws-reconcile') {
      await this.cabinetContext.runWithCabinet(payload.cabinetId, async () => {
        await this.bybit.pollOpenOrders();
      });
      return;
    }
    if (payload.type === 'recalc-closed-pnl') {
      const run = async () => {
        await this.bybit.processRecalcClosedPnlQueueJob({
          jobId: payload.jobId,
          dryRun: payload.dryRun,
          limit: payload.limit,
        });
      };
      if (payload.cabinetId) {
        await this.cabinetContext.runWithCabinet(payload.cabinetId, run);
      } else {
        await run();
      }
      return;
    }
    if (payload.type === 'notify-trade-cancelled') {
      const run = async () => {
        await this.bybit.processTradeCancelledNotificationJob({
          signalIds: payload.signalIds,
          reason: payload.reason,
        });
      };
      if (payload.cabinetId) {
        await this.cabinetContext.runWithCabinet(payload.cabinetId, run);
      } else {
        await run();
      }
    }
  }
}

