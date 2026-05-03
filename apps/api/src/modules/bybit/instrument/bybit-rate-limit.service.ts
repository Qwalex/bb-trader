import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { SettingsService } from '../../settings/settings.service';

type BybitResponseLike = { retCode?: unknown; retMsg?: unknown };

class BybitRateLimitRetCodeError extends Error {
  constructor(
    readonly retCode: number,
    readonly retMsg: string,
  ) {
    super(`bybit rate limit retCode=${retCode} retMsg=${retMsg}`);
    this.name = 'BybitRateLimitRetCodeError';
  }
}

/**
 * Очередь REST-вызовов Bybit по кабинету (или default), минимальный интервал между запросами
 * и backoff при признаках rate limit. Вложенные вызовы `run` для того же ключа не ставятся
 * в очередь повторно (избегаем deadlock при TP/SL → applyPositionStopLossFull).
 */
@Injectable()
export class BybitRateLimitService {
  private readonly queueTail = new Map<string, Promise<unknown>[]>();
  private readonly queueDepth = new Map<string, number[]>();
  private readonly queueCursor = new Map<string, number>();
  private readonly lastEndMs = new Map<string, number>();
  private readonly reentryContext = new AsyncLocalStorage<Set<string>>();

  constructor(
    private readonly settings: SettingsService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private accountKey(): string {
    return this.cabinetContext.getCabinetId() ?? 'default';
  }

  private async getIntervalMs(): Promise<number> {
    const raw = await this.settings.get('BYBIT_ACCOUNT_REQUEST_INTERVAL_MS');
    const n = raw != null && String(raw).trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(n) || n < 0) return 80;
    return Math.floor(n);
  }

  private async getBackoffMs(): Promise<number> {
    const raw = await this.settings.get('BYBIT_RATE_LIMIT_BACKOFF_MS');
    const n = raw != null && String(raw).trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(n) || n < 100) return 2000;
    return Math.floor(n);
  }

  private async getMaxConcurrency(): Promise<number> {
    const raw = await this.settings.get('BYBIT_ACCOUNT_MAX_CONCURRENCY');
    const n = raw != null && String(raw).trim() !== '' ? Number(raw) : Number.NaN;
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.min(8, Math.floor(n));
  }

  private static normalizeRetCode(retCode: unknown): number | null {
    const asNumber = Number(retCode);
    return Number.isFinite(asNumber) ? asNumber : null;
  }

  private static normalizeRetMsg(retMsg: unknown): string {
    return String(retMsg ?? '').trim().toLowerCase();
  }

  private isRateLimitSignal(params: {
    retCode: number | null;
    retMsg: string;
    text?: string;
  }): boolean {
    const { retCode, retMsg, text } = params;
    if (retCode === 10006 || retCode === 429) {
      return true;
    }
    const probe = `${retMsg} ${String(text ?? '')}`.toLowerCase();
    return /429|too many requests|rate.?limit|frequency/.test(probe);
  }

  isRateLimitError(err: unknown): boolean {
    return this.isLikelyRateLimit(err);
  }

  async runBybitCall<T extends BybitResponseLike>(fn: () => Promise<T>): Promise<T> {
    return this.run(async () => {
      const response = await fn();
      const retCode = BybitRateLimitService.normalizeRetCode(response?.retCode);
      const retMsg = BybitRateLimitService.normalizeRetMsg(response?.retMsg);
      if (this.isRateLimitSignal({ retCode, retMsg })) {
        throw new BybitRateLimitRetCodeError(retCode ?? -1, retMsg || 'rate limit');
      }
      return response;
    });
  }

  private isLikelyRateLimit(err: unknown): boolean {
    const s = String(err ?? '');
    if (/429|too many requests|rate.?limit|10006|frequency/i.test(s)) return true;
    if (typeof err === 'object' && err !== null && 'retCode' in err) {
      const c = Number((err as { retCode?: unknown }).retCode);
      if (c === 10006) return true;
    }
    return false;
  }

  private hasReentryForAccountKey(accountKey: string): boolean {
    return this.reentryContext.getStore()?.has(accountKey) === true;
  }

  private runInsideAccountContext<T>(accountKey: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.reentryContext.getStore();
    if (existing?.has(accountKey)) {
      return fn();
    }
    const next = new Set(existing ?? []);
    next.add(accountKey);
    return this.reentryContext.run(next, fn);
  }

  private ensureQueueLanes(accountKey: string, laneCount: number): {
    tails: Promise<unknown>[];
    depths: number[];
  } {
    const tails = this.queueTail.get(accountKey) ?? [];
    const depths = this.queueDepth.get(accountKey) ?? [];
    while (tails.length < laneCount) {
      tails.push(Promise.resolve());
      depths.push(0);
    }
    this.queueTail.set(accountKey, tails);
    this.queueDepth.set(accountKey, depths);
    return { tails, depths };
  }

  private pickLane(accountKey: string, laneCount: number, depths: number[]): number {
    if (laneCount <= 1) {
      return 0;
    }
    const start = this.queueCursor.get(accountKey) ?? 0;
    let chosen = 0;
    let bestDepth = Number.POSITIVE_INFINITY;
    for (let i = 0; i < laneCount; i += 1) {
      const idx = (start + i) % laneCount;
      const d = depths[idx] ?? 0;
      if (d < bestDepth) {
        bestDepth = d;
        chosen = idx;
      }
    }
    this.queueCursor.set(accountKey, (chosen + 1) % laneCount);
    return chosen;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const accountKey = this.accountKey();
    if (this.hasReentryForAccountKey(accountKey)) {
      return fn();
    }
    const laneCount = await this.getMaxConcurrency();
    const { tails, depths } = this.ensureQueueLanes(accountKey, laneCount);
    const lane = this.pickLane(accountKey, laneCount, depths);
    const prev = tails[lane] ?? Promise.resolve();
    depths[lane] = (depths[lane] ?? 0) + 1;

    const task = prev.then(() =>
      this.runThrottled(accountKey, () =>
        this.runInsideAccountContext(accountKey, fn),
      ),
    );

    tails[lane] = task
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        depths[lane] = Math.max(0, (depths[lane] ?? 1) - 1);
      });

    return task;
  }

  private async runThrottled<T>(accountKey: string, fn: () => Promise<T>): Promise<T> {
    const intervalMs = await this.getIntervalMs();
    const last = this.lastEndMs.get(accountKey) ?? 0;
    const wait = Math.max(0, last + intervalMs - Date.now());
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
    const backoffBase = await this.getBackoffMs();
    let attempt = 0;
    while (true) {
      try {
        const out = await fn();
        this.lastEndMs.set(accountKey, Date.now());
        return out;
      } catch (e) {
        if (attempt < 4 && this.isLikelyRateLimit(e)) {
          attempt += 1;
          await new Promise((r) => setTimeout(r, backoffBase * attempt));
          continue;
        }
        this.lastEndMs.set(accountKey, Date.now());
        throw e;
      }
    }
  }
}
