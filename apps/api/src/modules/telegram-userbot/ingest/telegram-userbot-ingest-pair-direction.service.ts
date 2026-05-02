import { Injectable } from '@nestjs/common';
import { normalizeTradingPair } from '@repo/shared';

import { AppLogService } from '../../app-log/app-log.service';
import { CLOSE_REOPEN_COOLDOWN_MS } from '../telegram-userbot.constants';

/**
 * Общее состояние ingest: блокировки по паре/направлению и кулдаун после close (pipeline + reply-ветки).
 */
@Injectable()
export class TelegramUserbotIngestPairDirectionService {
  private readonly pairDirectionTransitions = new Map<string, { count: number; reason?: string }>();
  private readonly pairDirectionCloseCooldownUntilMs = new Map<string, number>();

  constructor(private readonly appLog: AppLogService) {}

  private pairDirectionKey(pair: string, direction: 'long' | 'short'): string {
    return `${normalizeTradingPair(pair)}:${direction}`;
  }

  setCloseCooldown(pair: string, direction: 'long' | 'short'): void {
    const key = this.pairDirectionKey(pair, direction);
    const untilMs = Date.now() + CLOSE_REOPEN_COOLDOWN_MS;
    this.pairDirectionCloseCooldownUntilMs.set(key, untilMs);
    void this.appLog.append('debug', 'telegram', 'Userbot: close cooldown set', {
      pair: normalizeTradingPair(pair),
      direction,
      cooldownMs: CLOSE_REOPEN_COOLDOWN_MS,
      untilIso: new Date(untilMs).toISOString(),
    });
  }

  getCloseCooldownRemainingMs(pair: string, direction: 'long' | 'short'): number {
    const key = this.pairDirectionKey(pair, direction);
    const untilMs = this.pairDirectionCloseCooldownUntilMs.get(key);
    if (!untilMs) {
      return 0;
    }
    const remain = untilMs - Date.now();
    if (remain <= 0) {
      this.pairDirectionCloseCooldownUntilMs.delete(key);
      return 0;
    }
    return remain;
  }

  beginPairDirectionTransition(
    pair: string,
    direction: 'long' | 'short',
    reason?: string,
  ): void {
    const key = this.pairDirectionKey(pair, direction);
    const prev = this.pairDirectionTransitions.get(key);
    this.pairDirectionTransitions.set(key, {
      count: (prev?.count ?? 0) + 1,
      reason: reason ?? prev?.reason,
    });
    void this.appLog.append('debug', 'telegram', 'Userbot: pair/direction transition started', {
      pair: normalizeTradingPair(pair),
      direction,
      reason: reason ?? null,
      lockCount: (prev?.count ?? 0) + 1,
    });
  }

  endPairDirectionTransition(pair: string, direction: 'long' | 'short'): void {
    const key = this.pairDirectionKey(pair, direction);
    const prev = this.pairDirectionTransitions.get(key);
    if (!prev) {
      return;
    }
    if (prev.count <= 1) {
      this.pairDirectionTransitions.delete(key);
      void this.appLog.append('debug', 'telegram', 'Userbot: pair/direction transition finished', {
        pair: normalizeTradingPair(pair),
        direction,
      });
      return;
    }
    this.pairDirectionTransitions.set(key, {
      count: prev.count - 1,
      reason: prev.reason,
    });
    void this.appLog.append('debug', 'telegram', 'Userbot: pair/direction transition decremented', {
      pair: normalizeTradingPair(pair),
      direction,
      lockCount: prev.count - 1,
    });
  }

  async waitForPairDirectionTransitionIfAny(
    pair: string,
    direction: 'long' | 'short',
    timeoutMs = 15_000,
    pollMs = 250,
  ): Promise<{ waited: boolean; timedOut: boolean; waitedMs: number }> {
    const key = this.pairDirectionKey(pair, direction);
    if (!this.pairDirectionTransitions.has(key)) {
      return { waited: false, timedOut: false, waitedMs: 0 };
    }
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;
    while (Date.now() <= deadline) {
      if (!this.pairDirectionTransitions.has(key)) {
        return { waited: true, timedOut: false, waitedMs: Date.now() - startedAt };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return { waited: true, timedOut: true, waitedMs: Date.now() - startedAt };
  }
}
