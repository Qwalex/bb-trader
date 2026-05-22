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
  timers: ReturnType<typeof setTimeout>[];
  finished: boolean;
};

@Injectable()
export class BybitTpSlFastApplyService {
  private readonly logger = new Logger(BybitTpSlFastApplyService.name);
  private readonly active = new Map<string, ActiveFastApply>();

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
    const state: ActiveFastApply = {
      cabinetId,
      signalId,
      reason,
      timers: [],
      finished: false,
    };
    this.active.set(key, state);

    void this.appLog.append('info', 'bybit', 'TP_SL_FAST_APPLY: scheduled', {
      cabinetId,
      signalId,
      reason,
      delaysMs: delays,
    });

    delays.forEach((delayMs, index) => {
      const timer = setTimeout(() => {
        void this.runAttempt(key, index + 1, delays.length);
      }, Math.max(0, delayMs));
      state.timers.push(timer);
    });
  }

  private async runAttempt(key: string, attemptNum: number, totalAttempts: number): Promise<void> {
    const state = this.active.get(key);
    if (!state || state.finished) {
      return;
    }

    try {
      const result = await this.cabinetContext.runWithCabinetAsync(state.cabinetId, async () =>
        this.bybit.runFastTpSlApplyAttempt(state.signalId, state.reason, attemptNum),
      );

      if (result.done) {
        state.finished = true;
        void this.appLog.append('info', 'bybit', 'TP_SL_FAST_APPLY: done', {
          cabinetId: state.cabinetId,
          signalId: state.signalId,
          reason: state.reason,
          attempt: attemptNum,
        });
        this.cancelActive(key);
        return;
      }

      if (attemptNum >= totalAttempts) {
        state.finished = true;
        void this.appLog.append('warn', 'bybit', 'TP_SL_FAST_APPLY: exhausted retries', {
          cabinetId: state.cabinetId,
          signalId: state.signalId,
          reason: state.reason,
          attempts: totalAttempts,
        });
        this.cancelActive(key);
        await this.workers.enqueueCabinetPoll(state.cabinetId, 'fast-apply-fallback', 0);
      }
    } catch (e) {
      this.logger.warn(
        `TP_SL_FAST_APPLY attempt ${attemptNum} ${state.signalId}: ${formatError(e)}`,
      );
      if (attemptNum >= totalAttempts) {
        state.finished = true;
        this.cancelActive(key);
        await this.workers.enqueueCabinetPoll(state.cabinetId, 'fast-apply-fallback', 0);
      }
    }
  }

  private cancelActive(key: string): void {
    const state = this.active.get(key);
    if (!state) {
      return;
    }
    for (const timer of state.timers) {
      clearTimeout(timer);
    }
    this.active.delete(key);
  }
}
