import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { RestClientV5 } from 'bybit-api';

import { normalizeTradingPair } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { AppLogService } from '../app-log/app-log.service';
import { OrdersService } from '../orders/orders.service';

import { BybitClientService } from './bybit-client.service';
import type {
  RecalcClosedPnlJobStatus,
  RecalcClosedPnlResult,
  TradePnlBreakdownResult,
} from './bybit.types';
import { isFilledOrderStatus, pickLiveExposurePositionForDirection } from './bybit-order-helpers';

@Injectable()
export class BybitPnlService {
  private readonly logger = new Logger(BybitPnlService.name);
  private recalcQueue: Promise<void> = Promise.resolve();
  private readonly recalcJobs = new Map<string, RecalcClosedPnlJobStatus>();
  private readonly recalcJobOrder: string[] = [];

  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly bybitClient: BybitClientService,
  ) {}

  /** orderId в строке getClosedPnL — для привязки PnL к нашим ордерам, а не к list[0] для всех. */
  private static extractClosedPnlOrderId(row: unknown): string {
    if (!row || typeof row !== 'object') {
      return '';
    }
    const r = row as Record<string, unknown>;
    const v = r.orderId ?? r.orderID;
    return v != null && String(v).length > 0 ? String(v) : '';
  }

  private static parseFiniteNumber(
    value: unknown,
  ): number | undefined {
    if (value == null || String(value).trim() === '') {
      return undefined;
    }
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  /** В разных эндпоинтах Bybit время приходит в разных полях/форматах. */
  private static extractClosedPnlTimestampMs(
    row: unknown,
  ): number | undefined {
    if (!row || typeof row !== 'object') {
      return undefined;
    }
    const r = row as Record<string, unknown>;
    const raw =
      r.createdTime ??
      r.updatedTime ??
      r.execTime ??
      r.createdAt ??
      r.updatedAt;
    if (raw == null || String(raw).trim() === '') {
      return undefined;
    }
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
    const parsed = Date.parse(String(raw));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }

  /**
   * Closed PnL у TP/SL одной позиции может иметь разные orderId
   * (например, SL из setTradingStop). Поэтому:
   * 1) всегда берём строки с нашими orderId;
   * 2) если у нас уже есть совпадения по orderId — добираем строки по тому же символу
   *    после старта сигнала (буфер -60с на задержки времени от биржи).
   */
  sumClosedPnlForSignal(
    rows: unknown[],
    ourIds: Set<string>,
    direction: string,
    signalCreatedAt: Date,
    signalClosedAt?: Date | null,
  ): {
    totalPnl: number;
    grossPnl: number;
    hadParsedPnl: boolean;
    openFee: number;
    closeFee: number;
    execFee: number;
    totalFee: number;
  } {
    const createdAtMs = signalCreatedAt.getTime();
    const createdFloorMs = createdAtMs - 60_000;
    const expectedCloseSide = direction === 'short' ? 'buy' : 'sell';
    const closedCeilMs =
      signalClosedAt && Number.isFinite(signalClosedAt.getTime())
        ? signalClosedAt.getTime() + 5 * 60_000
        : undefined;

    const parsedRows = rows.map((row) => {
      const orderId = BybitPnlService.extractClosedPnlOrderId(row);
      const ts = BybitPnlService.extractClosedPnlTimestampMs(row);
      const rec = row as Record<string, unknown>;
      const side = String(rec.side ?? '').trim().toLowerCase();
      // В Bybit поле closedPnl используем как финальный PnL сделки (источник истины).
      const pnlFinalFromBybit =
        BybitPnlService.parseFiniteNumber(rec.closedPnl) ?? Number.NaN;
      const openFee = Math.abs(BybitPnlService.parseFiniteNumber(rec.openFee) ?? 0);
      const closeFee = Math.abs(BybitPnlService.parseFiniteNumber(rec.closeFee) ?? 0);
      const execFee = Math.abs(BybitPnlService.parseFiniteNumber(rec.execFee) ?? 0);
      const fee = openFee + closeFee + execFee;
      const pnlGross = Number.isFinite(pnlFinalFromBybit)
        ? pnlFinalFromBybit + fee
        : Number.NaN;
      return {
        orderId,
        side,
        ts,
        pnlFinalFromBybit,
        pnlGross,
        openFee,
        closeFee,
        execFee,
      };
    });

    const hasTrackedRows = parsedRows.some(
      (r) => r.orderId.length > 0 && ourIds.has(r.orderId),
    );

    const candidates = parsedRows.filter((r) => {
      // Для корректной привязки берём только закрывающую сторону:
      // long -> Sell, short -> Buy.
      if (r.side && r.side !== expectedCloseSide) {
        return false;
      }
      if (
        closedCeilMs !== undefined &&
        r.ts !== undefined &&
        r.ts > closedCeilMs
      ) {
        return false;
      }
      if (r.orderId.length > 0 && ourIds.has(r.orderId)) {
        return true;
      }
      if (!hasTrackedRows) {
        return false;
      }
      return r.ts !== undefined && r.ts >= createdFloorMs;
    });

    let totalPnl = 0;
    let grossPnl = 0;
    let totalOpenFee = 0;
    let totalCloseFee = 0;
    let totalExecFee = 0;
    let hadParsedPnl = false;
    for (const row of candidates) {
      if (!Number.isFinite(row.pnlFinalFromBybit)) {
        continue;
      }
      totalPnl += row.pnlFinalFromBybit;
      if (Number.isFinite(row.pnlGross)) {
        grossPnl += row.pnlGross;
      }
      totalOpenFee += row.openFee;
      totalCloseFee += row.closeFee;
      totalExecFee += row.execFee;
      hadParsedPnl = true;
    }

    return {
      totalPnl,
      grossPnl,
      hadParsedPnl,
      openFee: totalOpenFee,
      closeFee: totalCloseFee,
      execFee: totalExecFee,
      totalFee: totalOpenFee + totalCloseFee + totalExecFee,
    };
  }

  async fetchClosedPnlRowsForSymbol(
    client: RestClientV5,
    symbol: string,
    rangeStartMs: number,
    rangeEndMs: number,
  ): Promise<unknown[]> {
    // Bybit closed-pnl endpoint ограничивает диапазон запроса 7 днями.
    // Поэтому читаем диапазон чанками (до 7 дней), чтобы корректно покрывать старые сделки.
    const startMs = Math.max(0, rangeStartMs);
    const endMs = Math.max(startMs, rangeEndMs);
    const maxRangeMs = 7 * 24 * 60 * 60 * 1000;
    const rows: unknown[] = [];

    for (
      let rangeStart = startMs;
      rangeStart <= endMs;
      rangeStart += maxRangeMs + 1
    ) {
      const rangeEnd = Math.min(endMs, rangeStart + maxRangeMs);
      let cursor: string | undefined;
      const MAX_PAGES = 40;

      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await client.getClosedPnL({
          category: 'linear',
          symbol,
          startTime: rangeStart,
          endTime: rangeEnd,
          limit: 100,
          cursor,
        });
        if (res.retCode !== 0) {
          break;
        }

        const list = res.result?.list ?? [];
        if (list.length > 0) {
          rows.push(...list);
        }
        cursor = res.result?.nextPageCursor || undefined;
        if (!cursor || list.length === 0) {
          break;
        }
      }
    }

    return rows;
  }

  buildClosedPnlWindow(
    signalCreatedAt: Date,
    signalClosedAt?: Date | null,
  ): { startTime: number; endTime: number } {
    const startTime = Math.max(0, signalCreatedAt.getTime());
    const rawEnd = signalClosedAt?.getTime() ?? Date.now();
    const normalizedEnd = Number.isFinite(rawEnd) ? rawEnd : startTime;
    // Добавляем 1 секунду, чтобы не терять граничные записи закрытия по endTime.
    const endTime = Math.max(startTime, normalizedEnd + 1000);
    return { startTime, endTime };
  }

  /**
   * Fallback оценка PnL по исполнениям (execution list), когда ClosedPnL
   * не удаётся связать по orderId (например, SL с отдельным id из setTradingStop).
   */
  async estimateClosedPnlFromExecutions(params: {
    client: RestClientV5;
    symbol: string;
    direction: string;
    createdAt: Date;
    closedAt?: Date | null;
  }): Promise<{ netPnl: number; grossPnl: number; totalFees: number } | undefined> {
    const createdFloorMs = params.createdAt.getTime() - 60_000;
    const closedCeilMs =
      params.closedAt && Number.isFinite(params.closedAt.getTime())
        ? params.closedAt.getTime() + 5 * 60_000
        : undefined;
    const rows: Array<{ side: string; qty: number; value: number; fee: number; ts: number }> = [];
    let cursor: string | undefined;
    const MAX_PAGES = 8;

    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await params.client.getExecutionList({
        category: 'linear',
        symbol: params.symbol,
        limit: 50,
        cursor,
      });
      if (res.retCode !== 0) {
        break;
      }
      const list = res.result?.list ?? [];
      for (const ex of list) {
        const ts = Number(ex.execTime ?? 0);
        if (!Number.isFinite(ts) || ts < createdFloorMs) {
          continue;
        }
        if (closedCeilMs !== undefined && ts > closedCeilMs) {
          continue;
        }
        const qty = Number.parseFloat(String(ex.execQty ?? 0));
        const valueRaw = Number.parseFloat(String(ex.execValue ?? 0));
        const priceRaw = Number.parseFloat(String(ex.execPrice ?? 0));
        const feeRaw = Number.parseFloat(String(ex.execFee ?? 0));
        const value =
          Number.isFinite(valueRaw) && valueRaw > 0
            ? valueRaw
            : Number.isFinite(priceRaw) && Number.isFinite(qty)
              ? priceRaw * qty
              : Number.NaN;
        if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(value) || value <= 0) {
          continue;
        }
        rows.push({
          side: String(ex.side ?? '').toLowerCase(),
          qty,
          value,
          fee: Number.isFinite(feeRaw) ? Math.abs(feeRaw) : 0,
          ts,
        });
      }
      cursor = res.result?.nextPageCursor || undefined;
      if (!cursor || list.length === 0) {
        break;
      }
    }

    let buyQty = 0;
    let buyValue = 0;
    let sellQty = 0;
    let sellValue = 0;
    let totalFees = 0;
    for (const row of rows) {
      totalFees += row.fee;
      if (row.side === 'buy') {
        buyQty += row.qty;
        buyValue += row.value;
      } else if (row.side === 'sell') {
        sellQty += row.qty;
        sellValue += row.value;
      }
    }
    const matchedQty = Math.min(buyQty, sellQty);
    if (!Number.isFinite(matchedQty) || matchedQty <= 0) {
      return undefined;
    }
    const avgBuy = buyValue / buyQty;
    const avgSell = sellValue / sellQty;
    if (!Number.isFinite(avgBuy) || !Number.isFinite(avgSell)) {
      return undefined;
    }
    // Для matchedQty достаточно одной формулы:
    // realized PnL = sellValue - buyValue (до комиссий),
    // и для long, и для short.
    const pnl = (avgSell - avgBuy) * matchedQty;
    const netPnl = pnl - totalFees;
    if (!Number.isFinite(netPnl)) {
      return undefined;
    }
    return {
      netPnl,
      grossPnl: pnl,
      totalFees,
    };
  }

  async getTradePnlBreakdown(
    signalId: string,
    workspaceId?: string | null,
  ): Promise<TradePnlBreakdownResult> {
    const signal = await this.orders.getSignalWithOrders(signalId, workspaceId);
    if (!signal) {
      return {
        ok: false,
        signalId,
        source: 'unavailable',
        requestWindow: { startTime: 0, endTime: 0 },
        finalPnl: null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        error: 'Сделка не найдена',
      };
    }

    const requestWindow = this.buildClosedPnlWindow(signal.createdAt, signal.closedAt);
    const client = await this.bybitClient.getClient(workspaceId);
    if (!client) {
      return {
        ok: false,
        signalId,
        source: 'unavailable',
        requestWindow,
        finalPnl: signal.realizedPnl ?? null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        error: 'Нет подключенных ключей Bybit',
      };
    }

    const symbol = normalizeTradingPair(signal.pair);
    const ourIds = new Set<string>(
      signal.orders
        .map((o) => (o.bybitOrderId ? String(o.bybitOrderId) : ''))
        .filter((id): id is string => id.length > 0),
    );
    if (ourIds.size === 0) {
      return {
        ok: false,
        signalId,
        source: 'unavailable',
        requestWindow,
        finalPnl: signal.realizedPnl ?? null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        details: 'Нет bybitOrderId у ордеров сделки',
      };
    }

    try {
      const rows = await this.fetchClosedPnlRowsForSymbol(
        client,
        symbol,
        requestWindow.startTime,
        requestWindow.endTime,
      );
      const parsed = this.sumClosedPnlForSignal(
        rows,
        ourIds,
        signal.direction,
        signal.createdAt,
        signal.closedAt,
      );
      if (parsed.hadParsedPnl) {
        return {
          ok: true,
          signalId,
          source: 'closed_pnl',
          requestWindow,
          finalPnl: parsed.totalPnl,
          grossPnl: parsed.grossPnl,
          fees: {
            openFee: parsed.openFee,
            closeFee: parsed.closeFee,
            execFee: parsed.execFee,
            total: parsed.totalFee,
          },
        };
      }

      const fallback = await this.estimateClosedPnlFromExecutions({
        client,
        symbol,
        direction: signal.direction,
        createdAt: signal.createdAt,
        closedAt: signal.closedAt,
      });
      if (fallback) {
        return {
          ok: true,
          signalId,
          source: 'execution_fallback',
          requestWindow,
          finalPnl: fallback.netPnl,
          grossPnl: fallback.grossPnl,
          fees: {
            openFee: null,
            closeFee: null,
            execFee: fallback.totalFees,
            total: fallback.totalFees,
          },
          details: 'Расчёт по execution list (fallback)',
        };
      }

      return {
        ok: false,
        signalId,
        source: 'unavailable',
        requestWindow,
        finalPnl: signal.realizedPnl ?? null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        details: 'Не удалось получить комиссии и PnL из Bybit',
      };
    } catch (e) {
      return {
        ok: false,
        signalId,
        source: 'unavailable',
        requestWindow,
        finalPnl: signal.realizedPnl ?? null,
        grossPnl: null,
        fees: { openFee: null, closeFee: null, execFee: null, total: null },
        error: formatError(e),
      };
    }
  }

  startRecalcClosedSignalsPnlJob(params?: {
    limit?: number;
    dryRun?: boolean;
    workspaceId?: string | null;
  }): RecalcClosedPnlJobStatus {
    const dryRun = params?.dryRun ?? true;
    const limit = params?.limit ?? 200;
    const jobId = `recalc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const createdAt = new Date().toISOString();
    const job: RecalcClosedPnlJobStatus = {
      jobId,
      workspaceId: params?.workspaceId ?? null,
      status: 'queued',
      dryRun,
      limit,
      createdAt,
    };
    this.recalcJobs.set(jobId, job);
    this.recalcJobOrder.push(jobId);
    this.pruneOldRecalcJobs();

    this.recalcQueue = this.recalcQueue
      .catch(() => undefined)
      .then(async () => {
        const current = this.recalcJobs.get(jobId);
        if (!current) return;
        current.status = 'running';
        current.startedAt = new Date().toISOString();
        try {
          const result = await this.recalcClosedSignalsPnl({
            dryRun,
            limit,
            workspaceId: current.workspaceId,
          });
          current.status = 'completed';
          current.result = result;
          current.finishedAt = new Date().toISOString();
        } catch (e) {
          current.status = 'failed';
          current.error = formatError(e);
          current.finishedAt = new Date().toISOString();
          this.logger.error(`recalc job ${jobId} failed: ${current.error}`);
        }
      });

    return { ...job };
  }

  getRecalcClosedPnlJobStatus(
    jobId: string,
    workspaceId?: string | null,
  ): RecalcClosedPnlJobStatus | null {
    const job = this.recalcJobs.get(jobId);
    if (!job) {
      return null;
    }
    if (workspaceId && job.workspaceId !== workspaceId) {
      return null;
    }
    return { ...job };
  }

  private pruneOldRecalcJobs(): void {
    const MAX = 50;
    while (this.recalcJobOrder.length > MAX) {
      const oldId = this.recalcJobOrder.shift();
      if (oldId) {
        this.recalcJobs.delete(oldId);
      }
    }
  }

  async recalcClosedSignalsPnl(params?: {
    limit?: number;
    dryRun?: boolean;
    workspaceId?: string | null;
  }): Promise<RecalcClosedPnlResult> {
    const dryRun = params?.dryRun ?? true;
    const limit = params?.limit ?? 200;
    const workspaceId = params?.workspaceId;
    const client = await this.bybitClient.getClient(workspaceId);
    if (!client) {
      return {
        ok: false,
        dryRun,
        scanned: 0,
        updated: 0,
        unchanged: 0,
        skippedNoBybitOrders: 0,
        skippedNoClosedPnl: 0,
        errors: [
          {
            signalId: '-',
            error:
              'Нет подключенных ключей Bybit. Пересчет closed PnL невозможен.',
          },
        ],
      };
    }

    const closed = await this.orders.listClosedSignalsForPnlRecalc({ limit, workspaceId });
    let updated = 0;
    let unchanged = 0;
    let skippedNoBybitOrders = 0;
    let skippedNoClosedPnl = 0;
    const errors: { signalId: string; error: string }[] = [];

    for (const sig of closed) {
      const ourIds = new Set<string>(
        sig.orders
          .map((o) => (o.bybitOrderId ? String(o.bybitOrderId) : ''))
          .filter((id): id is string => id.length > 0),
      );
      if (ourIds.size === 0) {
        skippedNoBybitOrders += 1;
        continue;
      }

      try {
        const symbol = normalizeTradingPair(sig.pair);
        const requestWindow = this.buildClosedPnlWindow(sig.createdAt, sig.closedAt);
        const rows = await this.fetchClosedPnlRowsForSymbol(
          client,
          symbol,
          requestWindow.startTime,
          requestWindow.endTime,
        );
        const { totalPnl, hadParsedPnl } = this.sumClosedPnlForSignal(
          rows,
          ourIds,
          sig.direction,
          sig.createdAt,
          sig.closedAt,
        );

        let nextPnl: number | undefined;
        if (hadParsedPnl) {
          nextPnl = totalPnl;
        } else {
          // В recalc повторяем fallback из poll:
          // если closedPnL не удалось связать по orderId, считаем по execution list.
          // Для execution fallback комиссии исполнений вычитаются явно.
          const fallback = await this.estimateClosedPnlFromExecutions({
            client,
            symbol,
            direction: sig.direction,
            createdAt: sig.createdAt,
            closedAt: sig.closedAt,
          });
          nextPnl = fallback?.netPnl;
        }
        if (nextPnl === undefined) {
          skippedNoClosedPnl += 1;
          continue;
        }

        const nextStatus = nextPnl >= 0 ? 'CLOSED_WIN' : 'CLOSED_LOSS';
        const prevPnl = sig.realizedPnl;
        const pnlChanged =
          prevPnl === null ||
          prevPnl === undefined ||
          Math.abs(prevPnl - nextPnl) > 1e-9;
        const statusChanged = sig.status !== nextStatus;

        if (!pnlChanged && !statusChanged) {
          unchanged += 1;
          continue;
        }

        if (!dryRun) {
          await this.orders.updateSignalStatus(sig.id, {
            status: nextStatus,
            realizedPnl: nextPnl,
            closedAt: sig.closedAt ?? new Date(),
          });
        }
        updated += 1;
      } catch (e) {
        errors.push({ signalId: sig.id, error: formatError(e) });
      }
    }

    if (!dryRun) {
      void this.appLog.append(
        'info',
        'bybit',
        'recalc closed pnl completed',
        {
          scanned: closed.length,
          updated,
          unchanged,
          skippedNoBybitOrders,
          skippedNoClosedPnl,
          errors: errors.length,
        },
      );
    }

    return {
      ok: errors.length === 0,
      dryRun,
      scanned: closed.length,
      updated,
      unchanged,
      skippedNoBybitOrders,
      skippedNoClosedPnl,
      errors,
    };
  }
}
