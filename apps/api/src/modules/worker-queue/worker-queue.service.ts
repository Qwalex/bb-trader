import { forwardRef, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { formatError } from '../../common/format-error';
import { parseWorkerQueuePollConcurrency } from '../bybit/tpsl/bybit-tpsl-fast-retry.util';
import { PrismaService } from '../../prisma/prisma.service';
import type { BybitService } from '../bybit/bybit.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { CabinetService } from '../cabinet/cabinet.service';
import { SettingsService } from '../settings/settings.service';
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
  private readonly staleLockMs = 10 * 60 * 1000;
  /** Параллельные poll-cabinet на разных кабинетах (значение из settings/env на каждой итерации loop). */
  private readonly reconcilePollConcurrencyEnv = WorkerQueueService.readPollConcurrencyEnv();
  private running = false;
  private loopIteration = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
    private readonly settings: SettingsService,
    @Inject(
      forwardRef(() => {
        // Lazy resolve: цикл require worker-queue ↔ bybit (иначе Nest: undefined-провайдер / «CircularDependency»).
        return require('../bybit/bybit.service').BybitService;
      }),
    )
    private readonly bybit: BybitService,
  ) {}

  onModuleInit(): void {
    if (process.env.WORKER_QUEUE_ENABLED?.trim() === 'false') {
      this.logger.warn('worker queue disabled via WORKER_QUEUE_ENABLED=false');
      return;
    }
    if (this.reconcilePollConcurrencyEnv > 1) {
      this.logger.log(
        `worker queue reconcile poll concurrency env default=${this.reconcilePollConcurrencyEnv}`,
      );
    }
    setTimeout(async () => {
      await this.recoverStaleRunningJobs();
      this.running = true;
      void this.loop();
    }, 200);
  }

  private async recoverStaleRunningJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - this.staleLockMs);
    const staleJobs = await this.prisma.workerQueueJob.findMany({
      where: {
        status: 'running',
        lockedAt: { lte: staleBefore },
      },
      select: {
        id: true,
        attempts: true,
        queue: true,
        jobKey: true,
        lockedAt: true,
      },
      orderBy: { lockedAt: 'asc' },
    });
    if (staleJobs.length === 0) {
      return;
    }
    let requeued = 0;
    let failed = 0;
    for (const job of staleJobs) {
      const attempts = job.attempts + 1;
      const finalFailure = attempts >= this.maxAttempts;
      const lock = await this.prisma.workerQueueJob.updateMany({
        where: { id: job.id, status: 'running' },
        data: finalFailure
          ? {
              status: 'failed',
              attempts,
              error: `Recovered stale running job (lockedAt=${job.lockedAt?.toISOString() ?? 'n/a'})`,
              finishedAt: new Date(),
              lockedAt: null,
            }
          : {
              status: 'pending',
              attempts,
              error: `Recovered stale running job (lockedAt=${job.lockedAt?.toISOString() ?? 'n/a'})`,
              runAfter: new Date(Date.now() + attempts * 1_500),
              lockedAt: null,
            },
      });
      if (lock.count === 0) continue;
      if (finalFailure) {
        failed += 1;
      } else {
        requeued += 1;
      }
    }
    this.logger.warn(
      `stale worker recovery done: total=${staleJobs.length}, requeued=${requeued}, failed=${failed}`,
    );
  }

  private static readPollConcurrencyEnv(): number {
    const raw = Number(process.env.WORKER_QUEUE_POLL_CONCURRENCY ?? 3);
    if (!Number.isFinite(raw)) {
      return 3;
    }
    return Math.min(Math.max(Math.trunc(raw), 1), 8);
  }

  /** post-placement / WS / кабинеты с открытыми linear-сигналами — раньше в reconcile. */
  private static isPriorityPollReason(reason: string): boolean {
    const r = reason.trim().toLowerCase();
    return (
      r.includes('post-placement') ||
      r.startsWith('bybit-ws') ||
      r.includes('post_placement') ||
      r.includes('-active') ||
      r.includes('fast-apply')
    );
  }

  private static resolvePollRunAfter(reason: string, delayMs: number): Date {
    const base = Date.now() + Math.max(0, delayMs);
    if (WorkerQueueService.isPriorityPollReason(reason)) {
      return new Date(base - 5_000);
    }
    return new Date(base);
  }

  async enqueue(
    queue: WorkQueueName,
    jobKey: string,
    payload: WorkQueuePayload,
    delayMs = 0,
  ): Promise<void> {
    const runAfter = new Date(Date.now() + Math.max(0, delayMs));
    const existing = await this.prisma.workerQueueJob.findUnique({
      where: { jobKey },
      select: { status: true },
    });
    if (!existing) {
      await this.prisma.workerQueueJob.create({
        data: {
          queue,
          jobKey,
          payloadJson: JSON.stringify(payload),
          status: 'pending',
          runAfter,
        },
      });
      return;
    }
    if (existing.status === 'running') {
      return;
    }
    await this.prisma.workerQueueJob.update({
      where: { jobKey },
      data: {
        payloadJson: JSON.stringify(payload),
        status: 'pending',
        runAfter,
        error: null,
        lockedAt: null,
        finishedAt: null,
      },
    });
  }

  async enqueuePollSweep(reason = 'interval', delayMs = 0): Promise<void> {
    const cabinets = await this.cabinets.listActiveCabinets();
    const activeCabinetRows = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PENDING', 'ORDERS_PLACED', 'OPEN', 'PARSED'] },
        marketType: 'linear',
      },
      select: { cabinetId: true },
      distinct: ['cabinetId'],
    });
    const activeCabinetIds = new Set(
      activeCabinetRows
        .map((row) => row.cabinetId?.trim())
        .filter((id): id is string => Boolean(id)),
    );
    for (const cabinet of cabinets) {
      if (activeCabinetIds.has(cabinet.id)) {
        await this.enqueueCabinetPoll(cabinet.id, `${reason}-active`, delayMs);
      }
    }
    for (const cabinet of cabinets) {
      if (!activeCabinetIds.has(cabinet.id)) {
        await this.enqueueCabinetPoll(cabinet.id, reason, delayMs);
      }
    }
  }

  /**
   * Один кабинет — upsert по `poll-cabinet:{id}` сливает частые триггеры (WS, post-placement).
   * Если основной poll уже running — планируем followup, не сбрасывая running job.
   * Interval-sweep не сбрасывает уже pending job (иначе один кабинет с min createdAt монополизирует очередь).
   */
  async enqueueCabinetPoll(
    cabinetId: string,
    reason = 'poll-cabinet',
    delayMs = 0,
  ): Promise<void> {
    const id = cabinetId.trim();
    if (!id) {
      return;
    }
    if (!(await this.cabinets.isCabinetActive(id))) {
      return;
    }
    const jobKey = `poll-cabinet:${id}`;
    const payload: WorkQueuePayload = {
      type: 'poll-cabinet',
      cabinetId: id,
      reason,
    };
    const runAfter = WorkerQueueService.resolvePollRunAfter(reason, delayMs);
    const priority = WorkerQueueService.isPriorityPollReason(reason);
    const existing = await this.prisma.workerQueueJob.findUnique({
      where: { jobKey },
      select: { status: true, runAfter: true },
    });
    if (existing?.status === 'running') {
      await this.enqueue(
        WORK_QUEUE_RECONCILE,
        `${jobKey}:followup`,
        { ...payload, reason: `${reason}-followup` },
        priority ? Math.max(delayMs, 500) : Math.max(delayMs, 2_000),
      );
      return;
    }
    if (existing?.status === 'pending') {
      if (priority) {
        await this.prisma.workerQueueJob.update({
          where: { jobKey },
          data: {
            payloadJson: JSON.stringify(payload),
            runAfter,
            error: null,
          },
        });
      }
      return;
    }
    if (!existing) {
      await this.prisma.workerQueueJob.create({
        data: {
          queue: WORK_QUEUE_RECONCILE,
          jobKey,
          payloadJson: JSON.stringify(payload),
          status: 'pending',
          runAfter,
        },
      });
      return;
    }
    await this.prisma.workerQueueJob.update({
      where: { jobKey },
      data: {
        payloadJson: JSON.stringify(payload),
        status: 'pending',
        runAfter,
        error: null,
        lockedAt: null,
        finishedAt: null,
      },
    });
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
        this.loopIteration += 1;
        if (this.loopIteration % 40 === 0) {
          void this.logReconcileQueueBacklog();
        }
        await Promise.all([
          this.runQueue(WORK_QUEUE_EXECUTION),
          this.runReconcileQueues(),
          this.runQueue(WORK_QUEUE_NOTIFICATIONS),
        ]);
      } catch (e) {
        this.logger.warn(`worker loop: ${formatError(e)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }

  /** Периодически: возраст самой старой pending-задачи reconcile (нагрузка / заторы). */
  private async logReconcileQueueBacklog(): Promise<void> {
    try {
      const oldest = await this.prisma.workerQueueJob.findFirst({
        where: {
          queue: WORK_QUEUE_RECONCILE,
          status: 'pending',
          runAfter: { lte: new Date() },
        },
        orderBy: [{ runAfter: 'asc' }, { updatedAt: 'asc' }],
        select: { updatedAt: true, jobKey: true },
      });
      if (!oldest) return;
      // `createdAt` у upsert по jobKey не меняется — для pending возраст берём от updatedAt.
      const ageMs = Date.now() - oldest.updatedAt.getTime();
      if (ageMs > 15_000) {
        this.logger.warn(
          `worker_queue reconcile backlog oldestPendingAgeMs=${ageMs} jobKey=${oldest.jobKey}`,
        );
      } else if (ageMs > 5_000) {
        this.logger.debug(
          `worker_queue reconcile backlog oldestPendingAgeMs=${ageMs} jobKey=${oldest.jobKey}`,
        );
      }
    } catch (e) {
      this.logger.debug(`logReconcileQueueBacklog: ${formatError(e)}`);
    }
  }

  private async resolvePollConcurrency(): Promise<number> {
    try {
      const raw = await this.settings.get('WORKER_QUEUE_POLL_CONCURRENCY');
      return parseWorkerQueuePollConcurrency(raw, this.reconcilePollConcurrencyEnv);
    } catch {
      return this.reconcilePollConcurrencyEnv;
    }
  }

  private async runReconcileQueues(): Promise<void> {
    const concurrency = await this.resolvePollConcurrency();
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i += 1) {
      tasks.push(this.runQueue(WORK_QUEUE_RECONCILE));
    }
    await Promise.all(tasks);
  }

  private async runQueue(queue: WorkQueueName): Promise<void> {
    const job = await this.prisma.workerQueueJob.findFirst({
      where: {
        queue,
        status: 'pending',
        runAfter: { lte: new Date() },
      },
      orderBy: [{ runAfter: 'asc' }, { updatedAt: 'asc' }],
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
    const payload = JSON.parse(job.payloadJson) as WorkQueuePayload;
    const started = Date.now();
    try {
      await this.handlePayload(payload);
      const elapsed = Date.now() - started;
      if (queue === WORK_QUEUE_RECONCILE) {
        const brief =
          payload.type === 'poll-cabinet'
            ? `poll-cabinet cabinetId=${payload.cabinetId}`
            : payload.type === 'bybit-ws-reconcile'
              ? `bybit-ws-reconcile cabinetId=${payload.cabinetId}`
              : payload.type;
        if (elapsed > 8_000) {
          this.logger.warn(`worker_queue reconcile slow ${brief} durationMs=${elapsed}`);
        } else if (elapsed > 2_000) {
          this.logger.debug(`worker_queue reconcile ${brief} durationMs=${elapsed}`);
        }
      }
      await this.prisma.workerQueueJob.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          finishedAt: new Date(),
          error: null,
          lockedAt: null,
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
              lockedAt: null,
            }
          : {
              status: 'pending',
              attempts,
              error: formatError(e),
              runAfter: new Date(Date.now() + attempts * 1_500),
              lockedAt: null,
            },
      });
      if (finalFailure) {
        this.logger.error(`queue job ${job.id} failed: ${formatError(e)}`);
      }
    }
  }

  private async handlePayload(payload: WorkQueuePayload): Promise<void> {
    if (payload.type === 'poll-cabinet') {
      if (!(await this.cabinets.isCabinetActive(payload.cabinetId))) {
        return;
      }
      await this.cabinetContext.runWithCabinet(payload.cabinetId, async () => {
        await this.bybit.pollOpenOrders();
      });
      return;
    }
    if (payload.type === 'bybit-ws-reconcile') {
      if (!(await this.cabinets.isCabinetActive(payload.cabinetId))) {
        return;
      }
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

