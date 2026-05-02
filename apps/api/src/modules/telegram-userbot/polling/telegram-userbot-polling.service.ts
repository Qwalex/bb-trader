import { Injectable } from '@nestjs/common';

type PollingHooks = {
  getPollIntervalMs: () => Promise<number>;
  pollTick: () => Promise<void>;
};

@Injectable()
export class TelegramUserbotPollingService {
  private pollTimer: NodeJS.Timeout | null = null;

  async startLoop(hooks: PollingHooks): Promise<void> {
    if (this.pollTimer) {
      return;
    }
    const pollMs = await hooks.getPollIntervalMs();
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void hooks.pollTick().finally(() => {
        void this.startLoop(hooks);
      });
    }, pollMs);
  }

  stopLoop(): void {
    if (!this.pollTimer) {
      return;
    }
    clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
