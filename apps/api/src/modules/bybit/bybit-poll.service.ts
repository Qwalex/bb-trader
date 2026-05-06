import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { isTransientPrismaConnectionError } from '../../common/prisma-transient';
import { SettingsService } from '../settings/settings.service';
import { BybitService } from './bybit.service';

@Injectable()
export class BybitPollService {
  private readonly logger = new Logger(BybitPollService.name);
  private lastPollAt = 0;
  private isPolling = false;

  constructor(
    private readonly bybit: BybitService,
    private readonly settings: SettingsService,
  ) {}

  @Interval(1_000)
  async tick(): Promise<void> {
    try {
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
      await this.bybit.pollOpenOrders();
    } catch (e) {
      if (isTransientPrismaConnectionError(e)) {
        this.logger.warn(
          `poll: transient DB connection issue, skip tick (${e instanceof Error ? e.message : String(e)})`,
        );
        return;
      }
      this.logger.warn(`poll: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.isPolling = false;
    }
  }
}
