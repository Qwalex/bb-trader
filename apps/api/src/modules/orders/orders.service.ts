import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { PrismaService } from '../../prisma/prisma.service';

export interface TradesFilter {
  source?: string;
  pair?: string;
  from?: Date;
  to?: Date;
  status?: string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.signal.update({ where: { id }, data });
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
    return this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { orders: true },
    });
  }

  async listOpenSignals() {
    return this.prisma.signal.findMany({
      where: {
        status: { in: ['ORDERS_PLACED', 'OPEN'] },
      },
      include: { orders: true },
      orderBy: { createdAt: 'asc' },
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
      where: { status: 'ORDERS_PLACED', direction },
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
      where: { status: 'ORDERS_PLACED', direction },
      select: { id: true, pair: true },
    });
    const ids = open
      .filter((r) => normalizeTradingPair(r.pair) === want)
      .map((r) => r.id);
    if (ids.length === 0) {
      return 0;
    }
    const res = await this.prisma.signal.updateMany({
      where: { id: { in: ids } },
      data: {
        status: 'CLOSED_MIXED',
        closedAt: new Date(),
        realizedPnl: null,
      },
    });
    return res.count;
  }

  async getDashboardStats() {
    const closed = await this.prisma.signal.findMany({
      where: {
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
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
      where: { status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] } },
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

  async getPnlSeries(bucket: 'day' | 'week') {
    const closed = await this.prisma.signal.findMany({
      where: {
        closedAt: { not: null },
        realizedPnl: { not: null },
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

  async listTrades(f: TradesFilter) {
    const page = f.page ?? 1;
    const pageSize = Math.min(f.pageSize ?? 20, 100);
    const where: Prisma.SignalWhereInput = {};
    if (f.source) {
      where.source = f.source;
    }
    if (f.pair) {
      where.pair = f.pair;
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
    });
    return rows;
  }

  async statsByPair() {
    const rows = await this.prisma.signal.groupBy({
      by: ['pair', 'status'],
      _count: { id: true },
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
