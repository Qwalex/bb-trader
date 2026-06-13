import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { SettingsService } from '../../settings/settings.service';
import { isWorkerBybitProcessRole } from '../../../config/process-role.util';
import { WorkerQueueService } from '../../worker-queue/worker-queue.service';

@Injectable()
export class BybitPollService {
  private readonly logger = new Logger(BybitPollService.name);
  private lastPollAt = 0;
  private isPolling = false;

  constructor(
    private readonly settings: SettingsService,
    private readonly workers: WorkerQueueService,
  ) {}

  private static readonly POLL_DEFAULT_MS = 2000;
  private static readonly POLL_MIN_MS = 250;
  private static readonly POLL_MAX_MS = 600_000;

  @Interval(1_000)
  async tick(): Promise<void> {
    if (!isWorkerBybitProcessRole()) {
      return;
    }
    const msRaw = await this.settings.get('POLLING_INTERVAL_MS');
    const trimmed = (msRaw ?? '').trim();
    if (trimmed === '0') {
      return;
    }

    const configuredMs = Number(trimmed);
    const pollEveryMs =
      Number.isFinite(configuredMs) && configuredMs > 0
        ? Math.min(
            Math.max(Math.trunc(configuredMs), BybitPollService.POLL_MIN_MS),
            BybitPollService.POLL_MAX_MS,
          )
        : BybitPollService.POLL_DEFAULT_MS;
    const now = Date.now();
    if (this.isPolling || now - this.lastPollAt < pollEveryMs) {
      return;
    }

    this.isPolling = true;
    this.lastPollAt = now;
    try {
      await this.workers.enqueuePollSweep('interval');
    } catch (e) {
      this.logger.warn(`poll: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.isPolling = false;
    }
  }
}
