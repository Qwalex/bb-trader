import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { BybitService } from '../bybit/bybit.service';
import { SettingsService } from '../settings/settings.service';
import { UserbotSignalHashService } from '../telegram-userbot/userbot-signal-hash.service';

export interface TradesFilter {
  signalId?: string;
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    private readonly userbotSignalHash: UserbotSignalHashService,
  ) {}

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
    origin?: { chatId?: string; messageId?: string },
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
        sourceChatId: origin?.chatId ?? null,
        sourceMessageId: origin?.messageId ?? null,
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
    const row = await this.prisma.signal.findUnique({
      where: { id },
      select: { status: true },
    });
    if (
      row?.status &&
      OrdersService.CLOSED_SIGNAL_STATUSES.has(row.status)
    ) {
      void this.userbotSignalHash.releaseForSignalId(id);
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

  /**
   * Ручная привязка сделки к сообщению в Telegram (для close/reentry по цитате в userbot).
   * Нужны оба id или оба null (сброс).
   */
  async updateTradeTelegramSource(
    signalId: string,
    body: { sourceChatId: string | null; sourceMessageId: string | null },
  ) {
    const chatRaw = body.sourceChatId;
    const msgRaw = body.sourceMessageId;
    const nextChat =
      chatRaw === null || chatRaw === undefined
        ? null
        : String(chatRaw).trim();
    const nextMsg =
      msgRaw === null || msgRaw === undefined
        ? null
        : String(msgRaw).trim();

    const normalizedChat = nextChat && nextChat.length > 0 ? nextChat : null;
    const normalizedMsg = nextMsg && nextMsg.length > 0 ? nextMsg : null;

    if (Boolean(normalizedChat) !== Boolean(normalizedMsg)) {
      throw new BadRequestException(
        'Укажите оба поля: chat id и message id, или очистите оба (сброс привязки)',
      );
    }

    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        sourceChatId: true,
        sourceMessageId: true,
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
        `Нельзя менять привязку к Telegram для статуса: ${signal.status}`,
      );
    }

    if (normalizedChat && normalizedMsg) {
      const conflict = await this.prisma.signal.findFirst({
        where: {
          id: { not: signalId },
          deletedAt: null,
          sourceChatId: normalizedChat,
          sourceMessageId: normalizedMsg,
          status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
        },
        select: { id: true },
      });
      if (conflict) {
        throw new BadRequestException(
          `Уже есть активная сделка, привязанная к этому сообщению (${conflict.id.slice(0, 8)}…)`,
        );
      }
    }

    await this.prisma.signal.update({
      where: { id: signalId },
      data: {
        sourceChatId: normalizedChat,
        sourceMessageId: normalizedMsg,
      },
    });

    await this.createSignalEvent(signalId, 'TELEGRAM_LINK_UPDATED', {
      from: {
        sourceChatId: signal.sourceChatId,
        sourceMessageId: signal.sourceMessageId,
      },
      to: {
        sourceChatId: normalizedChat,
        sourceMessageId: normalizedMsg,
      },
    });

    return {
      ok: true,
      signalId,
      sourceChatId: normalizedChat,
      sourceMessageId: normalizedMsg,
    };
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

    void this.userbotSignalHash.releaseForSignalId(signalId);

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

  async createSignalEvent(
    signalId: string,
    type: string,
    payload?: unknown,
  ) {
    return this.prisma.signalEvent.create({
      data: {
        signalId,
        type,
        payload:
          payload === undefined ? null : JSON.stringify(payload),
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
    if (row.status === 'OPEN' || row.status === 'PARSED') {
      throw new BadRequestException(
        'Нельзя удалить активную сделку: сначала закройте позицию/ордера на бирже',
      );
    }
    if (row.status === 'ORDERS_PLACED') {
      const cleanup = await this.bybit.cleanupExchangeBeforeDeletingPlacedSignal(id);
      if (!cleanup.ok) {
        const tail = cleanup.details ? `: ${cleanup.details}` : '';
        throw new BadRequestException(
          `${cleanup.error ?? 'Не удалось снять ордера и закрыть позицию на Bybit'}${tail}`,
        );
      }
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
    const rawLimit = params?.limit;
    const where = {
      deletedAt: null,
      status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
    };
    const include = { orders: true };
    const orderBy = { closedAt: 'desc' as const };

    // limit=0 => пересчитать все закрытые сделки (без ограничений take)
    if (rawLimit === 0) {
      return this.prisma.signal.findMany({
      where: {
          ...where,
      },
        include,
        orderBy,
      });
    }

    const limit = Math.min(Math.max(rawLimit ?? 200, 1), 2000);
    return this.prisma.signal.findMany({
      where,
      include,
      orderBy,
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
   * Возвращает id сделок, переведённых в CLOSED_MIXED (для Telegram и т.п.).
   */
  async reconcileStaleOpenSignalsForPairAndDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<string[]> {
    const want = normalizeTradingPair(pair);
    const open = await this.prisma.signal.findMany({
      where: { deletedAt: null, status: 'ORDERS_PLACED', direction },
      select: { id: true, pair: true },
    });
    const ids = open
      .filter((r) => normalizeTradingPair(r.pair) === want)
      .map((r) => r.id);
    if (ids.length === 0) {
      return [];
    }
    const res = await this.prisma.signal.updateMany({
      where: { id: { in: ids }, deletedAt: null },
      data: {
        status: 'CLOSED_MIXED',
        closedAt: new Date(),
        realizedPnl: null,
      },
    });
    if (res.count === 0) {
      return [];
    }
    const updated = await this.prisma.signal.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        status: 'CLOSED_MIXED',
      },
      select: { id: true },
    });
    return updated.map((r) => r.id);
  }

  async getDashboardStats(params?: { source?: string }) {
    const source = params?.source;
    const excluded = await this.getExcludedSourcesSet();
    const statsResetAt = await this.getStatsResetAt();
    if (source && excluded.has(source)) {
      return {
        winrate: 0,
        wins: 0,
        losses: 0,
        totalClosed: 0,
        totalPnl: 0,
        openSignals: 0,
        avgProfitPnl: 0,
        avgLossPnl: 0,
        closedPerDayAvg: 0,
      };
    }
    const closed = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
        ...(statsResetAt ? { closedAt: { gte: statsResetAt } } : {}),
        ...(source ? { source } : {}),
      },
    });
    const closedFiltered = source
      ? closed
      : closed.filter((row) => !excluded.has(String(row.source ?? '')));
    const wins = closedFiltered.filter((s) => s.status === 'CLOSED_WIN').length;
    const losses = closedFiltered.filter((s) => s.status === 'CLOSED_LOSS').length;
    const total = wins + losses;
    const winrate = total === 0 ? 0 : (wins / total) * 100;
    const totalPnl = closedFiltered.reduce(
      (acc, s) => acc + (s.realizedPnl ?? 0),
      0,
    );

    const pnls = closedFiltered
      .map((s) => s.realizedPnl)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const profitPnls = pnls.filter((v) => v > 0);
    const lossPnls = pnls.filter((v) => v < 0);
    const avgProfitPnl =
      profitPnls.length > 0
        ? profitPnls.reduce((a, b) => a + b, 0) / profitPnls.length
        : 0;
    const avgLossPnl =
      lossPnls.length > 0
        ? lossPnls.reduce((a, b) => a + b, 0) / lossPnls.length
        : 0;

    const closedAtDates = closedFiltered
      .map((s) => s.closedAt)
      .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()));
    const now = Date.now();
    const startMs =
      statsResetAt?.getTime() ??
      (closedAtDates.length > 0
        ? Math.min(...closedAtDates.map((d) => d.getTime()))
        : now);
    const dayMs = 86_400_000;
    const days = Math.max(1, Math.ceil((now - startMs) / dayMs));
    const closedPerDayAvg = total / days;

    const openRows = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
        ...(statsResetAt ? { createdAt: { gte: statsResetAt } } : {}),
        ...(source ? { source } : {}),
      },
      select: { source: true },
    });
    const open = source
      ? openRows.length
      : openRows.filter((row) => !excluded.has(String(row.source ?? ''))).length;
    return {
      winrate,
      wins,
      losses,
      totalClosed: total,
      totalPnl,
      openSignals: open,
      avgProfitPnl,
      avgLossPnl,
      closedPerDayAvg,
    };
  }

  async getPnlSeries(bucket: 'day' | 'week', params?: { source?: string }) {
    const source = params?.source;
    const excluded = await this.getExcludedSourcesSet();
    const statsResetAt = await this.getStatsResetAt();
    if (source && excluded.has(source)) {
      return [];
    }
    const closed = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        closedAt: { not: null },
        realizedPnl: { not: null },
        ...(statsResetAt ? { closedAt: { gte: statsResetAt } } : {}),
        ...(source ? { source } : {}),
      },
      orderBy: { closedAt: 'asc' },
    });
    const closedFiltered = source
      ? closed
      : closed.filter((row) => !excluded.has(String(row.source ?? '')));
    const map = new Map<string, number>();
    for (const s of closedFiltered) {
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

  private parseStringList(raw: string | undefined): string[] {
    const text = String(raw ?? '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .filter((v) => v.length > 0);
    } catch {
      return text
        .split(/[\n,]/g)
        .map((v) => v.trim())
        .filter((v) => v.length > 0);
    }
  }

  private async getExcludedSourcesSet(): Promise<Set<string>> {
    const raw = await this.settings.get('SOURCE_EXCLUDE_LIST');
    return new Set(this.parseStringList(raw));
  }

  private async getStatsResetAt(): Promise<Date | undefined> {
    const raw = await this.settings.get('STATS_RESET_AT');
    if (!raw || raw.trim() === '') {
      return undefined;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  async resetAnalyticsStats() {
    const resetAt = new Date();
    await this.settings.set('STATS_RESET_AT', resetAt.toISOString());
    return { ok: true, resetAt: resetAt.toISOString() };
  }

  async getSourceStats(params?: { source?: string }) {
    const source = params?.source;
    const excluded = await this.getExcludedSourcesSet();
    const statsResetAt = await this.getStatsResetAt();
    if (source && excluded.has(source)) {
      return [];
    }
    const rows = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        ...(source ? { source } : {}),
      },
      select: {
        source: true,
        status: true,
        realizedPnl: true,
        createdAt: true,
        closedAt: true,
      },
    });
    const rowsFiltered = source
      ? rows
      : rows.filter((row) => !excluded.has(String(row.source ?? '')));
    const rowsResetFiltered = rowsFiltered.filter((row) => {
      if (!statsResetAt) {
        return true;
      }
      if (row.status === 'CLOSED_WIN' || row.status === 'CLOSED_LOSS' || row.status === 'CLOSED_MIXED') {
        return row.closedAt != null && row.closedAt >= statsResetAt;
      }
      if (row.status === 'ORDERS_PLACED' || row.status === 'OPEN' || row.status === 'PARSED') {
        return row.createdAt >= statsResetAt;
      }
      return false;
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
    for (const r of rowsResetFiltered) {
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
    const byWorstPnl = [...all].sort((a, b) => a.totalPnl - b.totalPnl).slice(0, limit);
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

    const decided = all.filter((r) => r.wins + r.losses > 0);
    const byWorstWinrate = [...decided]
      .sort((a, b) => {
        if (a.winrate !== b.winrate) return a.winrate - b.winrate;
        const aDec = a.wins + a.losses;
        const bDec = b.wins + b.losses;
        if (bDec !== aDec) return bDec - aDec;
        return a.totalPnl - b.totalPnl;
      })
      .slice(0, limit);
    const worstWinrate =
      byWorstWinrate.length > 0 ? (byWorstWinrate[0] ?? null) : null;
    const bestWinrate =
      byWinrate.length > 0 ? (byWinrate[0] ?? null) : null;

    return {
      byPnl,
      byWinrate,
      byWorstPnl,
      byWorstWinrate,
      worstWinrate,
      bestWinrate,
    };
  }

  async listTrades(f: TradesFilter) {
    const page = f.page ?? 1;
    const pageSize = Math.min(f.pageSize ?? 20, 100);
    const where: Prisma.SignalWhereInput = {};
    if (!f.includeDeleted) {
      where.deletedAt = null;
    }
    const signalId = f.signalId?.trim();
    if (signalId) {
      if (signalId.length >= 25) {
        where.id = signalId;
      } else {
        where.id = { startsWith: signalId };
      }
    } else {
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
    }
    const [items, total] = await Promise.all([
      this.prisma.signal.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          orders: true,
          events: {
            orderBy: { createdAt: 'desc' },
            take: 8,
          },
        },
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
    const excluded = await this.getExcludedSourcesSet();
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
      .filter((v) => !excluded.has(v))
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
