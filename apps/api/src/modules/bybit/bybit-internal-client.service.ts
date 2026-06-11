import { Injectable } from '@nestjs/common';

import {
  isDedicatedWorkerUserbotProcessRole,
  shouldProxyBybitToWorker,
} from '../../config/process-role.util';
import {
  readWorkerBybitInternalBaseUrl,
  workerInternalFetchJson,
  type WorkerHttpOptions,
} from '../../internal/worker-http.util';

@Injectable()
export class BybitInternalClientService {
  isRemotePlacementEnabled(): boolean {
    return (
      (shouldProxyBybitToWorker() || isDedicatedWorkerUserbotProcessRole()) &&
      Boolean(readWorkerBybitInternalBaseUrl())
    );
  }

  isEnabled(): boolean {
    return shouldProxyBybitToWorker() && Boolean(readWorkerBybitInternalBaseUrl());
  }

  private async call<T>(
    path: string,
    options: WorkerHttpOptions = {},
  ): Promise<T> {
    const base = readWorkerBybitInternalBaseUrl();
    if (!base) {
      throw new Error('WORKER_BYBIT_INTERNAL_URL is not configured');
    }
    return workerInternalFetchJson<T>(base, `/internal/bybit${path}`, options);
  }

  getLiveExposureSnapshot(cabinetId?: string | null): Promise<unknown> {
    return this.call('/live', { cabinetId });
  }

  getUnifiedUsdtBalanceDetails(cabinetId?: string | null): Promise<unknown> {
    return this.call('/unified-balance', { cabinetId });
  }

  getStuckTradesSnapshot(cabinetId?: string | null): Promise<unknown> {
    return this.call('/stuck-trades', { cabinetId });
  }

  listBalanceHistory(days: number, cabinetId?: string | null): Promise<unknown> {
    return this.call('/balance-history', {
      cabinetId,
      query: { days: String(days) },
    });
  }

  getSignalExecutionDebugSnapshot(
    signalId: string,
    cabinetId?: string | null,
  ): Promise<unknown> {
    return this.call(`/signal/${encodeURIComponent(signalId)}`, { cabinetId });
  }

  getTradePnlBreakdown(signalId: string, cabinetId?: string | null): Promise<unknown> {
    return this.call(`/trade-pnl-breakdown/${encodeURIComponent(signalId)}`, { cabinetId });
  }

  applyTpSlManually(signalId: string, cabinetId?: string | null): Promise<unknown> {
    return this.call(`/apply-tpsl/${encodeURIComponent(signalId)}`, {
      method: 'POST',
      cabinetId,
    });
  }

  closeSignalManually(signalId: string, cabinetId?: string | null): Promise<unknown> {
    return this.call(`/close/${encodeURIComponent(signalId)}`, {
      method: 'POST',
      cabinetId,
    });
  }

  startRecalcClosedSignalsPnl(
    body: { limit?: number; dryRun?: boolean },
    cabinetId?: string | null,
  ): Promise<unknown> {
    return this.call('/recalc-closed-pnl', {
      method: 'POST',
      body,
      cabinetId,
    });
  }

  recalcClosedSignalsPnl(
    body: { limit?: number; dryRun?: boolean },
    cabinetId?: string | null,
  ): Promise<unknown> {
    return this.call('/recalc-closed-pnl-sync', {
      method: 'POST',
      body,
      cabinetId,
    });
  }

  getRecalcClosedPnlJobStatus(jobId: string, cabinetId?: string | null): Promise<unknown> {
    return this.call(`/recalc-closed-pnl/${encodeURIComponent(jobId)}`, { cabinetId });
  }

  routeUserbotSignalPlacement(body: unknown, cabinetId?: string | null): Promise<unknown> {
    return this.call('/place-userbot-signal', {
      method: 'POST',
      body,
      cabinetId,
    });
  }
}
