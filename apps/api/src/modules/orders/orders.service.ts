import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { PrismaService } from '../../prisma/prisma.service';

export interface TradesFilter {
  source?: string;
  pair?: string;
  from?: Date;
  to?: Date;
  status?: string;
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  private static readonly ACTIVE_SIGNAL_STATUSES = new Set([
    'ORDERS_PLACED',
    'OPEN',
    'PARSED',
  ]);

  private static readonly CLOSED_SIGNAL_STATUSES = new Set([
    'CLOSED_WIN',
    'CLOSED_LOSS',
    'CLOSED_MIXED',
  ]);

  private static readonly SOURCE_EDIT_ALLOWED_STATUSES = new Set([
    ...Array.from(OrdersService.ACTIVE_SIGNAL_STATUSES),
    ...Array.from(OrdersService.CLOSED_SIGNAL_STATUSES),
  ]);
  private static readonly PNL_EDIT_ALLOWED_STATUSES = new Set([
    ...Array.from(OrdersService.CLOSED_SIGNAL_STATUSES),
  ]);

  async createSignalRecord(
    signal: SignalDto,
    rawMessage: string | undefined,
    status: string,
  ) {
    return this.prisma.signal.create({
      data: {
        pair: normalizeTradingPair(signal.pair),
        direction: signal.direction,
        entries: JSON.stringify(signal.entries),
        stopLoss: signal.stopLoss,
        takeProfits: JSON.stringify(signal.takeProfits),
        leverage: signal.leverage,
        orderUsd: signal.orderUsd,
        capitalPercent: signal.capitalPercent,
        source: signal.source ?? null,
        rawMessage: rawMessage ?? null,
        status,
      },
    });
  }

  async updateSignalStatus(
    id: string,
    data: Prisma.SignalUpdateInput,
  ) {
    const res = await this.prisma.signal.updateMany({
      where: { id, deletedAt: null },
      data,
    });
    if (res.count === 0) {
      throw new NotFoundException('Сделка не найдена');
    }
    return res;
  }

  /**
   * Обновляет source для сигнала и (если есть) для связанных сигналов.
   * "Связанные" определяем через общий набор `orders.bybitOrderId`.
   */
  async updateSignalSourceWithPropagation(signalId: string, source: string | null) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        orders: { select: { bybitOrderId: true } },
      },
    });

    if (!signal) {
      throw new NotFoundException('Сделка не найдена');
    }

    if (signal.deletedAt) {
      throw new NotFoundException('Сделка удалена');
    }

    if (!OrdersService.SOURCE_EDIT_ALLOWED_STATUSES.has(signal.status)) {
      throw new BadRequestException(
        `Нельзя менять source для статуса: ${signal.status}`,
      );
    }

    const bybitOrderIds = Array.from(
      new Set(
        (signal.orders ?? [])
          .map((o) => (o.bybitOrderId ? String(o.bybitOrderId).trim() : ''))
          .filter((id) => id.length > 0),
      ),
    );

    // Если у сигнала нет привязанных bybitOrderId — обновляем только его.
    if (bybitOrderIds.length === 0) {
      await this.prisma.signal.update({
        where: { id: signalId },
        data: { source },
      });
      return { ok: true, affectedSignals: 1 };
    }

    const connected = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        status: { in: Array.from(OrdersService.SOURCE_EDIT_ALLOWED_STATUSES) },
        orders: {
          some: {
            bybitOrderId: { in: bybitOrderIds },
          },
        },
      },
      select: { id: true },
    });

    const connectedIds = connected.map((r) => r.id);

    const res = await this.prisma.signal.updateMany({
      where: { id: { in: connectedIds } },
      data: { source },
    });

    return { ok: true, affectedSignals: res.count };
  }

  async updateTradePnlManual(signalId: string, realizedPnl: number | null) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      select: { id: true, status: true, deletedAt: true, closedAt: true },
    });
    if (!signal) {
      throw new NotFoundException('Сделка не найдена');
    }
    if (signal.deletedAt) {
      throw new NotFoundException('Сделка удалена');
    }
    if (!OrdersService.PNL_EDIT_ALLOWED_STATUSES.has(signal.status)) {
      throw new BadRequestException(
        `PnL можно корректировать только для закрытых сделок. Текущий статус: ${signal.status}`,
      );
    }

    const normalizedPnl =
      realizedPnl === null
        ? null
        : Number.isFinite(realizedPnl)
          ? realizedPnl
          : null;
    const nextStatus =
      normalizedPnl === null || normalizedPnl === 0
        ? 'CLOSED_MIXED'
        : normalizedPnl > 0
          ? 'CLOSED_WIN'
          : 'CLOSED_LOSS';

    await this.prisma.signal.update({
      where: { id: signalId },
      data: {
        realizedPnl: normalizedPnl,
        status: nextStatus,
        closedAt: signal.closedAt ?? new Date(),
      },
    });

    return {
      ok: true,
      signalId,
      realizedPnl: normalizedPnl,
      status: nextStatus,
    };
  }

  async createOrderRecord(data: {
    signalId: string;
    bybitOrderId?: string;
    orderKind: string;
    side: string;
    price?: number;
    qty?: number;
    status: string;
  }) {
    return this.prisma.order.create({
      data: {
        signalId: data.signalId,
        bybitOrderId: data.bybitOrderId ?? null,
        orderKind: data.orderKind,
        side: data.side,
        price: data.price ?? null,
        qty: data.qty ?? null,
        status: data.status,
      },
    });
  }

  async updateOrder(
    id: string,
    data: Prisma.OrderUpdateInput,
  ) {
    return this.prisma.order.update({ where: { id }, data });
  }

  async findOrderByBybitId(bybitOrderId: string) {
    return this.prisma.order.findFirst({ where: { bybitOrderId } });
  }

  async getSignalWithOrders(signalId: string) {
    return this.prisma.signal.findFirst({
      where: { id: signalId, deletedAt: null },
      include: { orders: true },
    });
  }

  async deleteTrade(id: string): Promise<void> {
    const row = await this.prisma.signal.findUnique({
      where: { id },
      select: { id: true, status: true, deletedAt: true },
    });
    if (!row) {
      throw new NotFoundException('Сделка не найдена');
    }
    if (row.deletedAt) {
      return;
    }
    if (OrdersService.ACTIVE_SIGNAL_STATUSES.has(row.status)) {
      throw new BadRequestException(
        'Нельзя удалить активную сделку: сначала закройте позицию/ордера на бирже',
      );
    }
    await this.prisma.signal.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restoreTrade(id: string): Promise<void> {
    const row = await this.prisma.signal.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!row) {
      throw new NotFoundException('Сделка не найдена');
    }
    if (!row.deletedAt) {
      return;
    }
    await this.prisma.signal.update({
      where: { id },
      data: { deletedAt: null },
    });
  }

  async listOpenSignals() {
    return this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ORDERS_PLACED', 'OPEN'] },
      },
      include: { orders: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listClosedSignalsForPnlRecalc(params?: { limit?: number }) {
    const limit = Math.min(Math.max(params?.limit ?? 200, 1), 2000);
    return this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
      },
      include: { orders: true },
      orderBy: { closedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Более ранний сигнал по той же паре/стороне уже закрыт с PnL после создания этого сигнала —
   * типичный дубликат записи на одну биржевую сделку.
   */
  async findOlderClosedSiblingAfterNewerCreated(
    pair: string,
    direction: string,
    excludeId: string,
    newerCreatedAt: Date,
  ) {
    const want = normalizeTradingPair(pair);
    return this.prisma.signal.findFirst({
      where: {
        pair: want,
        direction,
        id: { not: excludeId },
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS'] },
        closedAt: { not: null, gte: newerCreatedAt },
        createdAt: { lt: newerCreatedAt },
      },
      orderBy: { closedAt: 'desc' },
    });
  }

  /**
   * Есть ли незакрытый сигнал по паре и направлению (long/short раздельно).
   * Сравнение по нормализованной паре — в БД могли остаться старые записи с дефисами/регистром.
   */
  async hasActiveSignalForPairAndDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<boolean> {
    const want = normalizeTradingPair(pair);
    const open = await this.prisma.signal.findMany({
      where: { deletedAt: null, status: 'ORDERS_PLACED', direction },
      select: { pair: true },
    });
    return open.some((r) => normalizeTradingPair(r.pair) === want);
  }

  /**
   * Биржа по API «чиста» по этой стороне, а в БД остался ORDERS_PLACED — помечаем закрытыми (ручное закрытие на бирже).
   */
  async reconcileStaleOpenSignalsForPairAndDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<number> {
    const want = normalizeTradingPair(pair);
    const open = await this.prisma.signal.findMany({
      where: { deletedAt: null, status: 'ORDERS_PLACED', direction },
      select: { id: true, pair: true },
    });
    const ids = open
      .filter((r) => normalizeTradingPair(r.pair) === want)
      .map((r) => r.id);
    if (ids.length === 0) {
      return 0;
    }
    const res = await this.prisma.signal.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: {
        status: 'CLOSED_MIXED',
        closedAt: new Date(),
        realizedPnl: null,
      },
    });
    return res.count;
  }

  async getDashboardStats(params?: { source?: string }) {
    const source = params?.source;
    const closed = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
        ...(source ? { source } : {}),
      },
    });
    const wins = closed.filter((s) => s.status === 'CLOSED_WIN').length;
    const losses = closed.filter((s) => s.status === 'CLOSED_LOSS').length;
    const total = wins + losses;
    const winrate = total === 0 ? 0 : (wins / total) * 100;
    const totalPnl = closed.reduce(
      (acc, s) => acc + (s.realizedPnl ?? 0),
      0,
    );
    const open = await this.prisma.signal.count({
      where: {
        deletedAt: null,
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
        ...(source ? { source } : {}),
      },
    });
    return {
      winrate,
      wins,
      losses,
      totalClosed: total,
      totalPnl,
      openSignals: open,
    };
  }

  async getPnlSeries(bucket: 'day' | 'week', params?: { source?: string }) {
    const source = params?.source;
    const closed = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        closedAt: { not: null },
        realizedPnl: { not: null },
        ...(source ? { source } : {}),
      },
      orderBy: { closedAt: 'asc' },
    });
    const map = new Map<string, number>();
    for (const s of closed) {
      if (!s.closedAt || s.realizedPnl === null) continue;
      const d = s.closedAt;
      const key =
        bucket === 'day'
          ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          : `${d.getFullYear()}-W${getWeek(d)}`;
      map.set(key, (map.get(key) ?? 0) + s.realizedPnl);
    }
    return Array.from(map.entries()).map(([date, pnl]) => ({ date, pnl }));
  }

  private computeWinrate(wins: number, losses: number): number {
    const total = wins + losses;
    return total === 0 ? 0 : (wins / total) * 100;
  }

  async getSourceStats(params?: { source?: string }) {
    const source = params?.source;
    const rows = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        ...(source ? { source } : {}),
      },
      select: {
        source: true,
        status: true,
        realizedPnl: true,
      },
    });

    type Acc = {
      source: string | null;
      wins: number;
      losses: number;
      closedMixed: number;
      closedTotal: number;
      openTotal: number;
      totalPnl: number;
    };

    const map = new Map<string, Acc>();
    const keyOf = (s: string | null) => (s && s.trim().length > 0 ? s : '—');
    for (const r of rows) {
      const key = keyOf(r.source);
      const acc =
        map.get(key) ??
        ({
          source: key === '—' ? null : key,
          wins: 0,
          losses: 0,
          closedMixed: 0,
          closedTotal: 0,
          openTotal: 0,
          totalPnl: 0,
        } satisfies Acc);

      if (r.status === 'CLOSED_WIN') {
        acc.wins += 1;
        acc.closedTotal += 1;
      } else if (r.status === 'CLOSED_LOSS') {
        acc.losses += 1;
        acc.closedTotal += 1;
      } else if (r.status === 'CLOSED_MIXED') {
        acc.closedMixed += 1;
        acc.closedTotal += 1;
      } else if (
        r.status === 'ORDERS_PLACED' ||
        r.status === 'OPEN' ||
        r.status === 'PARSED'
      ) {
        acc.openTotal += 1;
      }

      if (
        r.status === 'CLOSED_WIN' ||
        r.status === 'CLOSED_LOSS' ||
        r.status === 'CLOSED_MIXED'
      ) {
        acc.totalPnl += r.realizedPnl ?? 0;
      }

      map.set(key, acc);
    }

    const items = Array.from(map.entries())
      .map(([, acc]) => ({
        source: acc.source,
        winrate: this.computeWinrate(acc.wins, acc.losses),
        wins: acc.wins,
        losses: acc.losses,
        wL: `${acc.wins} / ${acc.losses}`,
        totalClosed: acc.closedTotal,
        openSignals: acc.openTotal,
        totalPnl: acc.totalPnl,
      }))
      .sort((a, b) => {
        const as = a.source ?? '—';
        const bs = b.source ?? '—';
        return as.localeCompare(bs, 'ru');
      });

    return items;
  }

  async getTopSources(params?: { limit?: number }) {
    const limit = Math.min(Math.max(params?.limit ?? 5, 1), 50);
    const all = await this.getSourceStats();
    const byPnl = [...all].sort((a, b) => b.totalPnl - a.totalPnl).slice(0, limit);
    const byWinrate = [...all]
      .sort((a, b) => {
        if (b.winrate !== a.winrate) return b.winrate - a.winrate;
        // tie-breaker: больше "решённых" сделок (wins+losses)
        const aDec = a.wins + a.losses;
        const bDec = b.wins + b.losses;
        if (bDec !== aDec) return bDec - aDec;
        return b.totalPnl - a.totalPnl;
      })
      .slice(0, limit);

    return { byPnl, byWinrate };
  }

  async listTrades(f: TradesFilter) {
    const page = f.page ?? 1;
    const pageSize = Math.min(f.pageSize ?? 20, 100);
    const where: Prisma.SignalWhereInput = {};
    if (!f.includeDeleted) {
      where.deletedAt = null;
    }
    if (f.source) {
      if (f.source === '—') {
        where.source = null;
      } else {
        where.source = f.source;
      }
    }
    if (f.pair) {
      const want = normalizeTradingPair(f.pair);
      where.pair = {
        contains: want,
      };
    }
    if (f.status) {
      where.status = f.status;
    }
    if (f.from || f.to) {
      where.createdAt = {};
      if (f.from) {
        where.createdAt.gte = f.from;
      }
      if (f.to) {
        where.createdAt.lte = f.to;
      }
    }
    const [items, total] = await Promise.all([
      this.prisma.signal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { orders: true },
      }),
      this.prisma.signal.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async statsBySource() {
    const rows = await this.prisma.signal.groupBy({
      by: ['source', 'status'],
      _count: { id: true },
      where: { deletedAt: null },
    });
    return rows;
  }

  async listDistinctSources(): Promise<string[]> {
    const rows = await this.prisma.signal.groupBy({
      by: ['source'],
      _count: { id: true },
      where: {
        deletedAt: null,
        source: { not: null },
      },
    });

    return rows
      .map((r) => r.source)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .sort((a, b) => a.localeCompare(b, 'ru'));
  }

  async statsByPair() {
    const rows = await this.prisma.signal.groupBy({
      by: ['pair', 'status'],
      _count: { id: true },
      where: { deletedAt: null },
    });
    return rows;
  }
}

function getWeek(d: Date): string {
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const n = Math.ceil(
    ((d.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7,
  );
  return String(n).padStart(2, '0');
}
