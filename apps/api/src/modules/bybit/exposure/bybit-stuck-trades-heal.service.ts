import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';

import { formatError } from '../../../common/format-error';
import { AppLogService } from '../../app-log/app-log.service';
import { SettingsService } from '../../settings/settings.service';
import { WorkerQueueService } from '../../worker-queue/worker-queue.service';
import type { BybitService } from '../bybit.service';
import { parseStuckTradesHealSettings } from './bybit-stuck-trades-heal-settings.util';
import type { StuckTradesHealResult } from './bybit-stuck-trades-heal.types';
import { BybitStuckTradesService } from './bybit-stuck-trades.service';

/** Не мешаем свежему poll (<90 с) — он сам синхронизирует TP/SL. */
const POLL_RUNNING_DEFER_MS = 90_000;
/** Отложить heal при большой очереди reconcile. */
const RECONCILE_BACKLOG_DEFER_THRESHOLD = 14;

@Injectable()
export class BybitStuckTradesHealService {
  private readonly logger = new Logger(BybitStuckTradesHealService.name);
  /** cabinetId:signalId → last attempt timestamp */
  private readonly cooldownUntil = new Map<string, number>();

  constructor(
    private readonly settings: SettingsService,
    private readonly stuckTrades: BybitStuckTradesService,
    @Inject(
      forwardRef(() => {
        return require('../bybit.service').BybitService;
      }),
    )
    private readonly bybit: BybitService,
    private readonly appLog: AppLogService,
    @Inject(forwardRef(() => WorkerQueueService))
    private readonly workers: WorkerQueueService,
  ) {}

  async runAutoHealForCabinet(cabinetId: string): Promise<StuckTradesHealResult> {
    const cfg = await this.loadSettings();
    const empty = (patch: Partial<StuckTradesHealResult>): StuckTradesHealResult => ({
      ok: true,
      skipped: true,
      scanned: 0,
      attempted: 0,
      healed: 0,
      details: [],
      ...patch,
    });

    if (!cfg.enabled) {
      return empty({ skipReason: 'auto-heal disabled' });
    }

    if (await this.workers.isReconcileBacklogHigh(RECONCILE_BACKLOG_DEFER_THRESHOLD)) {
      void this.appLog.append('debug', 'bybit', 'STUCK_TRADES_AUTO_HEAL: отложено — backlog reconcile', {
        cabinetId,
        threshold: RECONCILE_BACKLOG_DEFER_THRESHOLD,
      });
      return empty({ skipReason: 'reconcile backlog' });
    }

    const pollFresh = await this.workers.getPollJobRunningAgeMs(cabinetId);
    if (pollFresh !== null && pollFresh < POLL_RUNNING_DEFER_MS) {
      return empty({ skipReason: 'poll active' });
    }

    if (pollFresh !== null && pollFresh >= POLL_RUNNING_DEFER_MS) {
      await this.workers.releaseStalePollJobForCabinet(cabinetId);
    }

    const snapshot = await this.stuckTrades.getStuckTradesSnapshot();
    if (!snapshot.bybitConnected) {
      return empty({ skipReason: 'bybit disconnected' });
    }

    const candidates = snapshot.items;
    if (candidates.length === 0) {
      return empty({ skipped: false, ok: true });
    }

    const now = Date.now();
    const details: StuckTradesHealResult['details'] = [];
    let attempted = 0;
    let healed = 0;

    for (const item of candidates) {
      if (attempted >= cfg.maxPerRun) {
        break;
      }
      const cdKey = `${cabinetId}:${item.signalId}`;
      const until = this.cooldownUntil.get(cdKey) ?? 0;
      if (until > now) {
        continue;
      }

      attempted += 1;
      try {
        const result = await this.bybit.applyTpSlManually(item.signalId, 'auto-heal');
        details.push({
          signalId: item.signalId,
          pair: item.pair,
          ok: result.ok,
          complete: result.complete,
          message: result.message,
        });
        if (result.complete || result.ok) {
          healed += 1;
          this.cooldownUntil.set(cdKey, now + cfg.cooldownMs);
        } else {
          this.cooldownUntil.set(cdKey, now + cfg.deferBackoffMs);
        }
        void this.appLog.append(
          result.complete ? 'info' : 'warn',
          'bybit',
          'STUCK_TRADES_AUTO_HEAL: попытка',
          {
            cabinetId,
            signalId: item.signalId,
            pair: item.pair,
            complete: result.complete,
            ok: result.ok,
            issues: item.issues.map((i) => i.kind),
          },
        );
      } catch (e) {
        const msg = formatError(e);
        details.push({
          signalId: item.signalId,
          pair: item.pair,
          ok: false,
          complete: false,
          message: msg,
        });
        this.cooldownUntil.set(cdKey, now + cfg.deferBackoffMs);
        this.logger.warn(`auto-heal ${item.signalId}: ${msg}`);
      }
    }

    return {
      ok: true,
      skipped: false,
      scanned: candidates.length,
      attempted,
      healed,
      details,
    };
  }

  private async loadSettings() {
    const keys = [
      'STUCK_TRADES_AUTO_HEAL_ENABLED',
      'STUCK_TRADES_AUTO_HEAL_INTERVAL_MS',
      'STUCK_TRADES_AUTO_HEAL_MAX_PER_RUN',
      'STUCK_TRADES_AUTO_HEAL_COOLDOWN_MS',
      'STUCK_TRADES_AUTO_HEAL_DEFER_BACKOFF_MS',
    ] as const;
    const raw: Partial<Record<(typeof keys)[number], string | null>> = {};
    for (const key of keys) {
      raw[key] = await this.settings.get(key);
    }
    return parseStuckTradesHealSettings(raw);
  }
}
