import { Injectable, Logger } from '@nestjs/common';

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
 * Строгая очередь REST-вызовов Bybit по кабинету (или `default`): один HTTP-запрос
 * за раз на ключ, минимальный интервал между успешными/неуспешными попытками и
 * backoff+retry при признаках rate limit (включая `retCode=10006` в теле ответа).
 */
@Injectable()
export class BybitRateLimitService {
  private readonly logger = new Logger(BybitRateLimitService.name);
  private readonly queueTail = new Map<string, Promise<unknown>>();
  private readonly lastEndMs = new Map<string, number>();
  private maxConcurrencyWarned = false;

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

  private async maybeWarnMaxConcurrencyIgnored(): Promise<void> {
    if (this.maxConcurrencyWarned) {
      return;
    }
    const raw = await this.settings.get('BYBIT_ACCOUNT_MAX_CONCURRENCY');
    const n = raw != null && String(raw).trim() !== '' ? Number(raw) : Number.NaN;
    if (Number.isFinite(n) && n > 1) {
      this.maxConcurrencyWarned = true;
      this.logger.warn(
        'BYBIT_ACCOUNT_MAX_CONCURRENCY>1 зарезервировано под будущий throughput; production-safe limiter держит один REST-канал на кабинет (эффективно 1). Значение игнорируется.',
      );
    }
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
    const accountKey = this.accountKey();
    return this.enqueue(accountKey, () => this.executeThrottledWithRetry(accountKey, fn));
  }

  private enqueue<T>(accountKey: string, work: () => Promise<T>): Promise<T> {
    const prev = this.queueTail.get(accountKey) ?? Promise.resolve();
    const task = prev.then(() => work());
    this.queueTail.set(
      accountKey,
      task
        .then(() => undefined)
        .catch(() => undefined),
    );
    return task;
  }

  private async executeThrottledWithRetry<T extends BybitResponseLike>(
    accountKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    await this.maybeWarnMaxConcurrencyIgnored();
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
        const response = await fn();
        const retCode = BybitRateLimitService.normalizeRetCode(response?.retCode);
        const retMsg = BybitRateLimitService.normalizeRetMsg(response?.retMsg);
        if (this.isRateLimitSignal({ retCode, retMsg })) {
          throw new BybitRateLimitRetCodeError(retCode ?? -1, retMsg || 'rate limit');
        }
        this.lastEndMs.set(accountKey, Date.now());
        return response;
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

  private isLikelyRateLimit(err: unknown): boolean {
    const s = String(err ?? '');
    if (/429|too many requests|rate.?limit|10006|frequency/i.test(s)) return true;
    if (typeof err === 'object' && err !== null && 'retCode' in err) {
      const c = Number((err as { retCode?: unknown }).retCode);
      if (c === 10006) return true;
    }
    return false;
  }
}
