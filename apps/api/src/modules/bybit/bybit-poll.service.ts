import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { SettingsService } from '../settings/settings.service';
import { WorkerQueueService } from '../worker-queue/worker-queue.service';

@Injectable()
export class BybitPollService {
  private readonly logger = new Logger(BybitPollService.name);
  private lastPollAt = 0;
  private isPolling = false;

  constructor(
    private readonly settings: SettingsService,
    private readonly workers: WorkerQueueService,
  ) {}

  @Interval(1_000)
  async tick(): Promise<void> {
    const msRaw = await this.settings.get('POLLING_INTERVAL_MS');
    if (msRaw === '0') {
      return;
    }

    const configuredMs = Number(msRaw);
    const pollEveryMs =
      Number.isFinite(configuredMs) && configuredMs > 0 ? configuredMs : 30_000;
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
