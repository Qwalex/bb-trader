import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { SettingsService } from '../../settings/settings.service';
import { WorkerQueueService } from '../../worker-queue/worker-queue.service';
import { parseStuckTradesAutoHealEnabled } from './bybit-stuck-trades-heal-settings.util';

@Injectable()
export class BybitStuckTradesHealSchedulerService {
  private readonly logger = new Logger(BybitStuckTradesHealSchedulerService.name);
  private lastSweepAt = 0;
  private ticking = false;

  constructor(
    private readonly settings: SettingsService,
    private readonly workers: WorkerQueueService,
  ) {}

  @Interval(30_000)
  async tick(): Promise<void> {
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const enabledRaw = await this.settings.get('STUCK_TRADES_AUTO_HEAL_ENABLED');
      if (!parseStuckTradesAutoHealEnabled(enabledRaw)) {
        return;
      }
      const intervalRaw = await this.settings.get('STUCK_TRADES_AUTO_HEAL_INTERVAL_MS');
      const intervalMs = parseIntervalMs(intervalRaw);
      const now = Date.now();
      if (now - this.lastSweepAt < intervalMs) {
        return;
      }
      this.lastSweepAt = now;
      await this.workers.enqueueStuckTradesHealSweep('interval');
    } catch (e) {
      this.logger.warn(`stuck trades heal tick: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.ticking = false;
    }
  }
}

function parseIntervalMs(raw: string | null | undefined): number {
  const t = (raw ?? '').trim();
  const fallback = 180_000;
  if (!t) {
    return fallback;
  }
  const n = Math.trunc(Number(t.replace(',', '.')));
  if (!Number.isFinite(n) || n < 60_000) {
    return fallback;
  }
  return Math.min(n, 900_000);
}
