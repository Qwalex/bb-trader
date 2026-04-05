import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { SettingsService } from '../settings/settings.service';
import { BybitService } from './bybit.service';

@Injectable()
export class BybitPollService {
  private readonly logger = new Logger(BybitPollService.name);
  private lastPollAt = 0;
  private isPolling = false;

  private cachedPollEveryMs = 30_000;
  private pollIntervalCachedAt = 0;
  private readonly INTERVAL_CACHE_TTL_MS = 60_000;

  constructor(
    private readonly bybit: BybitService,
    private readonly settings: SettingsService,
  ) {}

  private async getPollEveryMs(): Promise<number> {
    const now = Date.now();
    if (now - this.pollIntervalCachedAt < this.INTERVAL_CACHE_TTL_MS) {
      return this.cachedPollEveryMs;
    }
    const msRaw = await this.settings.get('POLLING_INTERVAL_MS');
    let resolved: number;
    if (msRaw === '0') {
      resolved = 0;
    } else {
      const configuredMs = Number(msRaw);
      resolved = Number.isFinite(configuredMs) && configuredMs > 0 ? configuredMs : 30_000;
    }
    this.cachedPollEveryMs = resolved;
    this.pollIntervalCachedAt = now;
    return resolved;
  }

  @Interval(1_000)
  async tick(): Promise<void> {
    const pollEveryMs = await this.getPollEveryMs();
    if (pollEveryMs === 0) {
      return;
    }

    const now = Date.now();
    if (this.isPolling || now - this.lastPollAt < pollEveryMs) {
      return;
    }

    this.isPolling = true;
    this.lastPollAt = now;
    try {
      await this.bybit.pollOpenOrders();
    } catch (e) {
      this.logger.warn(`poll: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.isPolling = false;
    }
  }
}
