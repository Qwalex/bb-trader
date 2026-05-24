import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { formatError } from '../../../common/format-error';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';
import { WorkerQueueService } from '../../worker-queue/worker-queue.service';
import type { BybitService } from '../bybit.service';
import {
  parseTpSlFastRetryDelaysMs,
} from './bybit-tpsl-fast-retry.util';

type ActiveFastApply = {
  cabinetId: string;
  signalId: string;
  reason: string;
  delays: number[];
  startTime: number;
  generation: number;
  finished: boolean;
};

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class BybitTpSlFastApplyService {
  private readonly logger = new Logger(BybitTpSlFastApplyService.name);
  private readonly active = new Map<string, ActiveFastApply>();
  private nextGeneration = 0;

  constructor(
    private readonly settings: SettingsService,
    private readonly cabinetContext: CabinetContextService,
    private readonly appLog: AppLogService,
    @Inject(forwardRef(() => WorkerQueueService))
    private readonly workers: WorkerQueueService,
    @Inject(
      forwardRef(() => {
        return require('../bybit.service').BybitService;
      }),
    )
    private readonly bybit: BybitService,
  ) {}

  scheduleFastTpSlApply(cabinetId: string, signalId: string, reason: string): void {
    const cab = cabinetId.trim();
    const sig = signalId.trim();
    if (!cab || !sig) {
      return;
    }
    void this.scheduleFastTpSlApplyAsync(cab, sig, reason);
  }

  private async isFastApplyEnabled(): Promise<boolean> {
    const raw = await this.settings.get('TP_SL_FAST_APPLY_ENABLED');
    const t = (raw ?? 'true').trim().toLowerCase();
    if (t === 'false' || t === '0' || t === 'off' || t === 'no') {
      return false;
    }
    return true;
  }

  private async scheduleFastTpSlApplyAsync(
    cabinetId: string,
    signalId: string,
    reason: string,
  ): Promise<void> {
    if (!(await this.isFastApplyEnabled())) {
      return;
    }

    const key = `${cabinetId}:${signalId}`;
    this.cancelActive(key);

    const delays = parseTpSlFastRetryDelaysMs(await this.settings.get('TP_SL_FAST_RETRY_DELAYS_MS'));
    const generation = ++this.nextGeneration;
    const state: ActiveFastApply = {
      cabinetId,
      signalId,
      reason,
      delays,
      startTime: Date.now(),
      generation,
      finished: false,
    };
    this.active.set(key, state);

    void this.appLog.append('info', 'bybit', 'TP_SL_FAST_APPLY: scheduled', {
      cabinetId,
      signalId,
      reason,
      delaysMs: delays,
      generation,
    });

    void this.runAttemptSequence(key, generation);
  }

  private isActiveGeneration(key: string, generation: number): ActiveFastApply | null {
    const state = this.active.get(key);
    if (!state || state.finished || state.generation !== generation) {
      return null;
    }
    return state;
  }

  private async runAttemptSequence(key: string, generation: number): Promise<void> {
    const initial = this.isActiveGeneration(key, generation);
    if (!initial) {
      return;
    }

    const totalAttempts = initial.delays.length;
    for (let index = 0; index < totalAttempts; index += 1) {
      const stateBeforeWait = this.isActiveGeneration(key, generation);
      if (!stateBeforeWait) {
        return;
      }

      const waitMs = Math.max(0, stateBeforeWait.startTime + stateBeforeWait.delays[index]! - Date.now());
      await sleepMs(waitMs);

      const state = this.isActiveGeneration(key, generation);
      if (!state) {
        return;
      }

      const attemptNum = index + 1;
      const shouldContinue = await this.runAttempt(key, generation, attemptNum, totalAttempts);
      if (!shouldContinue) {
        return;
      }
    }
  }

  /** @returns false — цепочку завершить; true — следующая попытка по расписанию. */
  private async runAttempt(
    key: string,
    generation: number,
    attemptNum: number,
    totalAttempts: number,
  ): Promise<boolean> {
    const state = this.isActiveGeneration(key, generation);
    if (!state) {
      return false;
    }

    try {
      const result = await this.cabinetContext.runWithCabinetAsync(state.cabinetId, async () =>
        this.bybit.runFastTpSlApplyAttempt(state.signalId, state.reason, attemptNum),
      );

      const current = this.isActiveGeneration(key, generation);
      if (!current) {
        return false;
      }

      if (result.done) {
        current.finished = true;
        void this.appLog.append('info', 'bybit', 'TP_SL_FAST_APPLY: done', {
          cabinetId: current.cabinetId,
          signalId: current.signalId,
          reason: current.reason,
          attempt: attemptNum,
          generation,
        });
        this.cancelActive(key);
        return false;
      }

      if (attemptNum >= totalAttempts) {
        current.finished = true;
        void this.appLog.append('warn', 'bybit', 'TP_SL_FAST_APPLY: exhausted retries', {
          cabinetId: current.cabinetId,
          signalId: current.signalId,
          reason: current.reason,
          attempts: totalAttempts,
          generation,
        });
        this.cancelActive(key);
        await this.workers.enqueueCabinetPoll(current.cabinetId, 'fast-apply-fallback', 0);
        return false;
      }

      return true;
    } catch (e) {
      this.logger.warn(
        `TP_SL_FAST_APPLY attempt ${attemptNum} ${state.signalId}: ${formatError(e)}`,
      );
      const current = this.isActiveGeneration(key, generation);
      if (!current) {
        return false;
      }
      if (attemptNum >= totalAttempts) {
        current.finished = true;
        this.cancelActive(key);
        await this.workers.enqueueCabinetPoll(current.cabinetId, 'fast-apply-fallback', 0);
        return false;
      }
      return true;
    }
  }

  private cancelActive(key: string): void {
    const state = this.active.get(key);
    if (!state) {
      return;
    }
    state.finished = true;
    this.active.delete(key);
  }
}
