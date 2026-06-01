import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { normalizeTradingPair, type SignalDto } from '@repo/shared';

import { PrismaService } from '../../prisma/prisma.service';
import { CabinetService } from '../cabinet/cabinet.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import type { BybitService } from '../bybit/bybit.service';
import type { BalanceSnapshotService } from '../bybit/balance-snapshot.service';
import { SettingsService } from '../settings/settings.service';
import { TelegramService } from '../telegram';
import { UserbotSignalHashService } from '../telegram-userbot/userbot-signal-hash.service';
import type { TelegramUserbotService } from '../telegram-userbot/telegram-userbot.service';
import type { SignalDistributionService } from '../qpulse-sync/signal-distribution.service';

import { formatError } from '../../common/format-error';
import type {
  DashboardCabinetCardDto,
  DashboardCabinetsOverviewDto,
} from './orders-dashboard-cabinets.types';
import type { DashboardActivityItemDto } from './orders-dashboard-activity.types';
import {
  DASHBOARD_ACTIVITY_INGEST_STATUSES,
  mapIngestRouteToActivity,
  mapSignalCloseToActivity,
  mapSignalOpenToActivity,
} from './orders-dashboard-activity.util';
import { buildAggregatedBalanceHistoryPoints } from './orders-dashboard-aggregate-balance-history.util';
import { buildDashboardCabinetsSummary } from './orders-dashboard-summary.util';
import { mapWithConcurrency } from './orders-async-pool.util';
import {
  buildDashboardCabinetBalanceGuard,
  parseMinBalanceUsdSetting,
} from './orders-dashboard-balance-guard.util';
import {
  getCachedDashboardCabinetsOverview,
  invalidateDashboardCabinetsOverviewCache,
  setCachedDashboardCabinetsOverview,
} from './orders-dashboard-overview-cache.util';
import {
  computeAvgIdlePeriodMs,
  computeAvgSignalExecutionMs,
  computeAvgUnusedBalanceRatioMonth,
  computeUnusedBalanceRatio,
  DASHBOARD_ACTIVE_SIGNAL_STATUSES,
  DASHBOARD_CLOSED_SIGNAL_STATUSES,
  filterSignalsByExcludedSources,
} from './orders-dashboard-utilization.util';
import type { DashboardCabinetUtilizationMetrics } from './orders-dashboard-utilization.types';
import { USERBOT_MIN_BALANCE_USD_DEFAULT } from '../telegram-userbot/telegram-userbot.constants';
import type { ActiveSignalTradeSnapshot } from './orders-active-signal-snapshot.types';
import type { OrdersDailyDigestModel } from './orders-digest.types';
import { parseStringList } from './orders-source.util';
import {
  computeWinratePercent,
  isClosedLossOutcome,
} from './orders-stats.util';

export interface TradesFilter {
  signalId?: string;
  source?: string;
  pair?: string;
  from?: Date;
  to?: Date;
  status?: string;
  includeDeleted?: boolean;
  sortBy?: 'createdAt' | 'closedAt';
  page?: number;
  pageSize?: number;
  /**
   * true — для каждой закрытой сделки запросить PnL с Bybit (медленно при большой странице).
   * По умолчанию false: показывать `realizedPnl` из БД без обращения к бирже.
   */
  refreshPnlFromExchange?: boolean;
  /**
   * true — посчитать шаг мартингейла по истории источника (тяжёлый запрос при длинной истории).
   * По умолчанию false: поле не заполняется (в UI «—»).
   */
  includeMartingaleSteps?: boolean;
}

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
    @Inject(
      forwardRef(() => {
        // Lazy resolve: избегаем потенциальных циклов DI между userbot и orders.
        return require('../telegram-userbot/telegram-userbot.service').TelegramUserbotService;
      }),
    )
    private readonly userbot: TelegramUserbotService,
    @Inject(
      forwardRef(() => {
        // Lazy resolve: избегаем циклического require() bybit.service ↔ orders.service (Nest иначе видит undefined-провайдер).
        return require('../bybit/bybit.service').BybitService;
      }),
    )
    private readonly bybit: BybitService,
    @Inject(
      forwardRef(() => {
        return require('../bybit/balance-snapshot.service').BalanceSnapshotService;
      }),
    )
    private readonly balanceSnapshots: BalanceSnapshotService,
    @Inject(forwardRef(() => TelegramService))
    private readonly telegram: TelegramService,
    private readonly userbotSignalHash: UserbotSignalHashService,
    @Inject(
      forwardRef(() =>
        require('../qpulse-sync/signal-distribution.service').SignalDistributionService,
      ),
    )
    private readonly signalDistribution: SignalDistributionService,
  ) {}

  private static readonly ACTIVE_SIGNAL_STATUSES = new Set([
    'PENDING',
    'ORDERS_PLACED',
    'OPEN',
    'PARSED',
  ]);
  private static readonly ACTIVE_SIGNAL_STATUS_LIST = Array.from(
    OrdersService.ACTIVE_SIGNAL_STATUSES,
  );

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
  private static readonly CLOSED_STATUSES = new Set([
    'CLOSED_WIN',
    'CLOSED_LOSS',
    'CLOSED_MIXED',
  ]);

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  private async findActiveSignalConflictByPairAndDirection(params: {
    cabinetId: string;
    pair: string;
    direction: 'long' | 'short';
  }): Promise<{ id: string; status: string } | null> {
    const rows = await this.prisma.signal.findMany({
      where: {
        cabinetId: params.cabinetId,
        deletedAt: null,
        status: { in: OrdersService.ACTIVE_SIGNAL_STATUS_LIST },
        direction: params.direction,
      },
      select: { id: true, pair: true, status: true },
      orderBy: { createdAt: 'desc' },
    });
    const wantedPair = normalizeTradingPair(params.pair);
    const found = rows.find((row) => normalizeTradingPair(row.pair) === wantedPair);
    if (!found) {
      return null;
    }
    return { id: found.id, status: found.status };
  }

  private withCabinetScope(where: Prisma.SignalWhereInput): Prisma.SignalWhereInput {
    const cabinetId = this.currentCabinetId();
    if (!cabinetId) {
      return where;
    }
    return {
      AND: [{ cabinetId }, where],
    };
  }

  /**
   * Как в getDashboardStats / getSourceStats: сигнал учитывается, если `!excluded.has(String(source ?? ''))`.
   */
  private sourceNotExcludedWhere(excluded: Set<string>): Prisma.SignalWhereInput {
    if (excluded.size === 0) {
      return {};
    }
    const orParts: Prisma.SignalWhereInput[] = [];
    for (const k of excluded) {
      if (k === '') {
        orParts.push({ source: null });
        orParts.push({ source: '' });
      } else {
        orParts.push({ source: k });
      }
    }
    return { NOT: { OR: orParts } };
  }

  private startOfTodayLocal(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /**
   * Компактные агрегаты для Telegram «Сводка» — без findMany по всей истории сигналов
   * (иначе при десятках тысяч сделок ответ занимает минуты).
   */
  async getTelegramMenuSummaryBundle(): Promise<{
    winrate: number;
    wins: number;
    losses: number;
    totalClosed: number;
    totalPnl: number;
    openSignals: number;
    todayPnl: number;
    bestWinrate: { source: string | null; winrate: number; wL: string } | null;
    worstWinrate: { source: string | null; winrate: number; wL: string } | null;
  }> {
    const [excluded, statsResetAt] = await Promise.all([
      this.getExcludedSourcesSet(),
      this.getStatsResetAt(),
    ]);
    const srcEx = this.sourceNotExcludedWhere(excluded);
    const closedCommon = {
      deletedAt: null,
      status: {
        in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'],
      },
      ...(statsResetAt ? { closedAt: { gte: statsResetAt } } : {}),
      ...srcEx,
    };
    const dayStart = this.startOfTodayLocal();
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);
    const todayClosedFrom = new Date(
      Math.max(dayStart.getTime(), statsResetAt?.getTime() ?? dayStart.getTime()),
    );
    const closedTodayWhere = {
      ...closedCommon,
      closedAt: {
        gte: todayClosedFrom,
        lt: dayEnd,
      },
    };

    const [closedByStatus, openSignals, todayAgg, bySourceStatus] = await Promise.all([
      this.prisma.signal.groupBy({
        by: ['status'],
        where: this.withCabinetScope(closedCommon),
        _count: { _all: true },
        _sum: { realizedPnl: true },
      }),
      this.prisma.signal.count({
        where: this.withCabinetScope({
          deletedAt: null,
          status: { in: ['PENDING', 'ORDERS_PLACED', 'OPEN', 'PARSED'] },
          ...(statsResetAt ? { createdAt: { gte: statsResetAt } } : {}),
          ...srcEx,
        }),
      }),
      this.prisma.signal.aggregate({
        where: this.withCabinetScope(closedTodayWhere),
        _sum: { realizedPnl: true },
      }),
      this.prisma.signal.groupBy({
        by: ['source', 'status'],
        where: this.withCabinetScope(closedCommon),
        _count: { _all: true },
        _sum: { realizedPnl: true },
      }),
    ]);

    let wins = 0;
    let losses = 0;
    let totalPnl = 0;
    for (const row of closedByStatus) {
      const n = row._count._all;
      totalPnl += row._sum.realizedPnl ?? 0;
      if (row.status === 'CLOSED_WIN') wins += n;
      else if (row.status === 'CLOSED_LOSS') losses += n;
    }
    const totalClosed = wins + losses;
    const winrate = computeWinratePercent(wins, losses);
    const todayPnl = todayAgg._sum.realizedPnl ?? 0;

    type Acc = { wins: number; losses: number; source: string | null; totalPnl: number };
    const perSource = new Map<string, Acc>();
    const keyOf = (s: string | null) => (s != null && s.trim().length > 0 ? s : '—');
    for (const row of bySourceStatus) {
      if (excluded.has(String(row.source ?? ''))) {
        continue;
      }
      const key = keyOf(row.source);
      const src = key === '—' ? null : key;
      let acc = perSource.get(key);
      if (!acc) {
        acc = { wins: 0, losses: 0, source: src, totalPnl: 0 };
        perSource.set(key, acc);
      }
      const n = row._count._all;
      acc.totalPnl += row._sum.realizedPnl ?? 0;
      if (row.status === 'CLOSED_WIN') acc.wins += n;
      else if (row.status === 'CLOSED_LOSS') acc.losses += n;
    }

    type WrRow = { source: string | null; wins: number; losses: number; totalPnl: number };
    const wrRows: WrRow[] = [];
    for (const acc of perSource.values()) {
      if (acc.wins + acc.losses === 0) continue;
      wrRows.push({
        source: acc.source,
        wins: acc.wins,
        losses: acc.losses,
        totalPnl: acc.totalPnl,
      });
    }
    const byWin = [...wrRows].sort((a, b) => {
      const wrA = computeWinratePercent(a.wins, a.losses);
      const wrB = computeWinratePercent(b.wins, b.losses);
      if (wrB !== wrA) return wrB - wrA;
      const aDec = a.wins + a.losses;
      const bDec = b.wins + b.losses;
      if (bDec !== aDec) return bDec - aDec;
      return b.totalPnl - a.totalPnl;
    });
    const bestWinrate =
      byWin.length > 0
        ? {
            source: byWin[0]!.source,
            winrate: computeWinratePercent(byWin[0]!.wins, byWin[0]!.losses),
            wL: `${byWin[0]!.wins} / ${byWin[0]!.losses}`,
          }
        : null;
    const byWorst = [...wrRows].sort((a, b) => {
      const wrA = computeWinratePercent(a.wins, a.losses);
      const wrB = computeWinratePercent(b.wins, b.losses);
      if (wrA !== wrB) return wrA - wrB;
      const aDec = a.wins + a.losses;
      const bDec = b.wins + b.losses;
      if (bDec !== aDec) return bDec - aDec;
      return a.totalPnl - b.totalPnl;
    });
    let worstWinrate =
      byWorst.length > 0
        ? {
            source: byWorst[0]!.source,
            winrate: computeWinratePercent(byWorst[0]!.wins, byWorst[0]!.losses),
            wL: `${byWorst[0]!.wins} / ${byWorst[0]!.losses}`,
          }
        : null;
    if (bestWinrate && worstWinrate && bestWinrate.source === worstWinrate.source) {
      worstWinrate = null;
    }

    return {
      winrate,
      wins,
      losses,
      totalClosed,
      totalPnl,
      openSignals,
      todayPnl,
      bestWinrate,
      worstWinrate,
    };
  }

  /** Для API списка сделок: убрать вложенный `cabinet`, добавить плоское имя для UI. */
  private toTradeListClientRow<
    T extends {
      cabinet?: { name: string; slug: string } | null;
      cabinetId: string | null;
    },
  >(item: T): Omit<T, 'cabinet'> & { cabinetName: string | null } {
    const { cabinet, ...rest } = item;
    const cabinetName =
      cabinet?.name?.trim() ||
      cabinet?.slug?.trim() ||
      (typeof rest.cabinetId === 'string' ? rest.cabinetId.trim() : '') ||
      null;
    return { ...(rest as Omit<T, 'cabinet'>), cabinetName };
  }

  async createSignalRecord(
    signal: SignalDto,
    rawMessage: string | undefined,
    status: string,
    origin?: { chatId?: string; messageId?: string; signalExternalId?: string },
    options?: { marketType?: 'linear' | 'spot' },
  ) {
    const cabinetId = this.currentCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    const normalizedPair = normalizeTradingPair(signal.pair);
    const sourceChatId = origin?.chatId?.trim() || null;
    const sourceMessageId = origin?.messageId?.trim() || null;
    const signalExternalId = origin?.signalExternalId?.trim() || null;

    const conflict = await this.findActiveSignalConflictByPairAndDirection({
      cabinetId,
      pair: normalizedPair,
      direction: signal.direction,
    });
    if (conflict) {
      throw new BadRequestException(
        `По паре ${normalizedPair} уже есть активный сигнал ${signal.direction.toUpperCase()} (${conflict.id.slice(0, 8)}…, статус ${conflict.status})`,
      );
    }

    if (sourceChatId && sourceMessageId) {
      const existing = await this.prisma.signal.findFirst({
        where: {
          cabinetId,
          deletedAt: null,
          sourceChatId,
          sourceMessageId,
          status: { in: OrdersService.ACTIVE_SIGNAL_STATUS_LIST },
        },
        select: { id: true },
      });
      if (existing) {
        throw new BadRequestException(
          `По этому Telegram-сообщению уже есть активная сделка (${existing.id.slice(0, 8)}…)`,
        );
      }
    }

    try {
      const marketType = options?.marketType ?? 'linear';
      const signalToStore = await this.bybit.resolveMarketEntryIfMissing(signal, marketType);
      const created = await this.prisma.signal.create({
        data: {
          cabinetId,
          pair: normalizedPair,
          direction: signalToStore.direction,
          entries: JSON.stringify(signalToStore.entries),
          entryIsRange: signalToStore.entryIsRange === true,
          stopLoss: signalToStore.stopLoss,
          takeProfits: JSON.stringify(signalToStore.takeProfits),
          leverage: signalToStore.leverage,
          orderUsd: signalToStore.orderUsd,
          capitalPercent: signalToStore.capitalPercent,
          source: signalToStore.source ?? null,
          sourceChatId,
          sourceMessageId,
          signalExternalId,
          rawMessage: rawMessage ?? null,
          status,
          marketType: options?.marketType ?? 'linear',
        },
      });
      void this.signalDistribution.onSignalCreated(created.id);
      return created;
    } catch (e) {
      const msg = formatError(e);
      if (msg.includes('Signal_active_pair_direction_unique')) {
        throw new BadRequestException(
          `По паре ${normalizedPair} уже есть активный сигнал ${signal.direction.toUpperCase()}`,
        );
      }
      throw e;
    }
  }

  async updateSignalStatus(
    id: string,
    data: Prisma.SignalUpdateInput,
  ) {
    const res = await this.prisma.signal.updateMany({
      where: this.withCabinetScope({ id, deletedAt: null }),
      data,
    });
    if (res.count === 0) {
      throw new NotFoundException('Сделка не найдена');
    }
    const row = await this.prisma.signal.findFirst({
      where: this.withCabinetScope({ id }),
      select: { status: true, liquidation: true, realizedPnl: true },
    });
    if (
      row?.status &&
      OrdersService.CLOSED_SIGNAL_STATUSES.has(row.status)
    ) {
      void this.userbotSignalHash.releaseForSignalId(id);
      void this.signalDistribution.onTradeClosed({
        signalId: id,
        liquidation: row.liquidation === true,
        realizedPnl: row.realizedPnl,
      });
    }
    void this.signalDistribution.onLifecycleUpdate(id);
    return res;
  }

  /**
   * Обновляет source для сигнала и (если есть) для связанных сигналов.
   * "Связанные" определяем через общий набор `orders.bybitOrderId`.
   */
  async updateSignalSourceWithPropagation(signalId: string, source: string | null) {
    const signal = await this.prisma.signal.findFirst({
      where: this.withCabinetScope({ id: signalId }),
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
      await this.prisma.signal.updateMany({
        where: this.withCabinetScope({ id: signalId }),
        data: { source },
      });
      return { ok: true, affectedSignals: 1 };
    }

    const connected = await this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: Array.from(OrdersService.SOURCE_EDIT_ALLOWED_STATUSES) },
        orders: {
          some: {
            bybitOrderId: { in: bybitOrderIds },
          },
        },
      }),
      select: { id: true },
    });

    const connectedIds = connected.map((r) => r.id);

    const res = await this.prisma.signal.updateMany({
      where: this.withCabinetScope({ id: { in: connectedIds } }),
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

    const signal = await this.prisma.signal.findFirst({
      where: this.withCabinetScope({ id: signalId }),
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

    await this.prisma.$transaction(async (tx) => {
      if (normalizedChat && normalizedMsg) {
        const conflict = await tx.signal.findFirst({
          where: this.withCabinetScope({
            id: { not: signalId },
            deletedAt: null,
            sourceChatId: normalizedChat,
            sourceMessageId: normalizedMsg,
            status: { in: ['PENDING', 'ORDERS_PLACED', 'OPEN', 'PARSED'] },
          }),
          select: { id: true },
        });
        if (conflict) {
          throw new BadRequestException(
            `Уже есть активная сделка, привязанная к этому сообщению (${conflict.id.slice(0, 8)}…)`,
          );
        }
      }
      await tx.signal.updateMany({
        where: this.withCabinetScope({ id: signalId }),
        data: {
          sourceChatId: normalizedChat,
          sourceMessageId: normalizedMsg,
        },
      });
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
    const signal = await this.prisma.signal.findFirst({
      where: this.withCabinetScope({ id: signalId }),
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

    await this.prisma.signal.updateMany({
      where: this.withCabinetScope({ id: signalId }),
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
    const row = await this.prisma.signalEvent.create({
      data: {
        signalId,
        type,
        payload:
          payload === undefined ? null : JSON.stringify(payload),
      },
    });
    await this.telegram.notifyTradeSignalEvent({ signalId, type, payload }).catch((e) =>
      this.logger.warn(`notifyTradeSignalEvent: ${formatError(e)}`),
    );
    void this.signalDistribution.onSignalEvent(signalId, type, payload);
    return row;
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
      where: this.withCabinetScope({ id: signalId, deletedAt: null }),
      include: { orders: true },
    });
  }

  async deleteTrade(
    id: string,
    options?: {
      allowActiveCleanup?: boolean;
    },
  ): Promise<void> {
    const row = await this.prisma.signal.findFirst({
      where: this.withCabinetScope({ id }),
      select: { id: true, status: true, deletedAt: true },
    });
    if (!row) {
      throw new NotFoundException('Сделка не найдена');
    }
    if (row.deletedAt) {
      return;
    }
    const allowActiveCleanup = options?.allowActiveCleanup === true;
    if ((row.status === 'OPEN' || row.status === 'PARSED') && !allowActiveCleanup) {
      throw new BadRequestException(
        'Нельзя удалить активную сделку: сначала закройте позицию/ордера на бирже',
      );
    }
    if (
      row.status === 'PENDING' ||
      row.status === 'ORDERS_PLACED' ||
      row.status === 'OPEN'
    ) {
      const cleanup = await this.bybit.cleanupExchangeBeforeDeletingPlacedSignal(id);
      if (!cleanup.ok) {
        const tail = cleanup.details ? `: ${cleanup.details}` : '';
        throw new BadRequestException(
          `${cleanup.error ?? 'Не удалось снять ордера и закрыть позицию на Bybit'}${tail}`,
        );
      }
    }
    await this.prisma.signal.updateMany({
      where: this.withCabinetScope({ id }),
      data: { deletedAt: new Date() },
    });
    void this.userbotSignalHash.releaseForSignalId(id);
  }

  async deleteAllTradesSequential(): Promise<{
    ok: boolean;
    total: number;
    deleted: number;
    failed: number;
    errors: Array<{
      signalId: string;
      status: string;
      error: string;
    }>;
    stats: {
      winrate: number;
      wins: number;
      losses: number;
      totalClosed: number;
      totalPnl: number;
      openSignals: number;
      avgProfitPnl: number;
      avgLossPnl: number;
      closedPerDayAvg: number;
    };
  }> {
    const rows = await this.prisma.signal.findMany({
      where: this.withCabinetScope({ deletedAt: null }),
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const errors: Array<{ signalId: string; status: string; error: string }> = [];
    let deleted = 0;

    for (const row of rows) {
      try {
        await this.deleteTrade(row.id, { allowActiveCleanup: true });
        deleted += 1;
      } catch (e) {
        errors.push({
          signalId: row.id,
          status: row.status,
          error: e instanceof Error ? e.message : 'Ошибка удаления',
        });
      }
    }

    const stats = await this.getDashboardStats();
    return {
      ok: errors.length === 0,
      total: rows.length,
      deleted,
      failed: errors.length,
      errors,
      stats,
    };
  }

  async restoreTrade(id: string): Promise<void> {
    const row = await this.prisma.signal.findFirst({
      where: this.withCabinetScope({ id }),
      select: { id: true, deletedAt: true },
    });
    if (!row) {
      throw new NotFoundException('Сделка не найдена');
    }
    if (!row.deletedAt) {
      return;
    }
    await this.prisma.signal.updateMany({
      where: this.withCabinetScope({ id }),
      data: { deletedAt: null },
    });
  }

  async listOpenSignals() {
    return this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: ['PENDING', 'ORDERS_PLACED', 'OPEN', 'PARSED'] },
      }),
      include: { orders: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Open signals для linear poll (legacy rows без marketType = linear). */
  async listOpenLinearSignals() {
    return this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: OrdersService.ACTIVE_SIGNAL_STATUS_LIST },
        marketType: 'linear',
      }),
      include: { orders: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Open spot signals для spot lifecycle poll. */
  async listOpenSpotSignals() {
    return this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: OrdersService.ACTIVE_SIGNAL_STATUS_LIST },
        marketType: 'spot',
      }),
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
        where: this.withCabinetScope({
          ...where,
        }),
        include,
        orderBy,
      });
    }

    const limit = Math.min(Math.max(rawLimit ?? 200, 1), 2000);
    return this.prisma.signal.findMany({
      where: this.withCabinetScope(where),
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
      where: this.withCabinetScope({
        pair: want,
        direction,
        id: { not: excludeId },
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS'] },
        closedAt: { not: null, gte: newerCreatedAt },
        createdAt: { lt: newerCreatedAt },
      }),
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
    const cabinetId = this.currentCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    const hit = await this.findActiveSignalConflictByPairAndDirection({
      cabinetId,
      pair,
      direction,
    });
    return hit !== null;
  }

  /**
   * Активная сделка в БД по паре и направлению (для аудита противоположной стороны при hedge).
   */
  async findActiveSignalTradeSnapshotForPairAndDirection(
    pair: string,
    direction: 'long' | 'short',
  ): Promise<ActiveSignalTradeSnapshot | null> {
    const cabinetId = this.currentCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    const wantedPair = normalizeTradingPair(pair);
    const rows = await this.prisma.signal.findMany({
      where: {
        cabinetId,
        deletedAt: null,
        status: { in: OrdersService.ACTIVE_SIGNAL_STATUS_LIST },
        direction,
      },
      select: {
        id: true,
        pair: true,
        direction: true,
        status: true,
        entries: true,
        entryIsRange: true,
        stopLoss: true,
        takeProfits: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        source: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    const found = rows.find((row) => normalizeTradingPair(row.pair) === wantedPair);
    return found ?? null;
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
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: OrdersService.ACTIVE_SIGNAL_STATUS_LIST },
        direction,
        marketType: { not: 'spot' },
      }),
      select: { id: true, pair: true },
    });
    const ids = open
      .filter((r) => normalizeTradingPair(r.pair) === want)
      .map((r) => r.id);
    if (ids.length === 0) {
      return [];
    }
    const res = await this.prisma.signal.updateMany({
      where: this.withCabinetScope({ id: { in: ids }, deletedAt: null }),
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
      where: this.withCabinetScope({
        id: { in: ids },
        deletedAt: null,
        status: 'CLOSED_MIXED',
      }),
      select: { id: true },
    });
    const closedIds = updated.map((r) => r.id);
    for (const id of closedIds) {
      void this.userbotSignalHash.releaseForSignalId(id);
    }
    return closedIds;
  }

  /**
   * Сводка по всем кабинетам пользователя для дашборда (win/lose/winrate/pnl/balance).
   * Bybit — до 3 кабинетов параллельно (очередь rate limit на кабинет); краткий кэш 20 с.
   */
  async getDashboardCabinetsOverviewForUser(
    userIdRaw: string | null | undefined,
  ): Promise<DashboardCabinetsOverviewDto> {
    const userId = String(userIdRaw ?? '').trim();
    if (!userId) {
      return {
        items: [],
        summary: buildDashboardCabinetsSummary([]),
        aggregatedBalanceHistory: [],
      };
    }
    const cached = getCachedDashboardCabinetsOverview(userId);
    if (cached) {
      return cached;
    }

    const cabinets = await this.cabinets.listCabinetsForUser(userId);
    const probeCabinetId =
      cabinets.find((c) => c.isActive)?.id ?? cabinets[0]?.id ?? null;
    let userbotConnectedGlobal = false;
    if (probeCabinetId) {
      userbotConnectedGlobal = await this.cabinetContext.runWithCabinet(
        probeCabinetId,
        async () => {
          try {
            const status = await this.userbot.getStatus();
            return Boolean(status?.connected);
          } catch {
            return false;
          }
        },
      );
    }

    const items = await mapWithConcurrency(cabinets, 3, async (c) =>
      this.cabinetContext.runWithCabinet(c.id, async () => {
        const stats = await this.getDashboardStats();
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        let totalBalanceUsd: number | null = null;
        let availableBalanceUsd: number | null = null;
        const [
          userbotReadMessagesToday,
          userbotSignalsPlacedToday,
          enabledGroupsCount,
          required,
          minBalanceRaw,
        ] = await Promise.all([
          this.prisma.cabinetIngestRoute.count({
            where: { cabinetId: c.id, createdAt: { gte: startOfToday } },
          }),
          this.prisma.cabinetIngestRoute.count({
            where: { cabinetId: c.id, createdAt: { gte: startOfToday }, status: 'placed' },
          }),
          this.prisma.cabinetTelegramSource.count({
            where: { cabinetId: c.id, enabled: true },
          }),
          this.settings.getMany([
            'BYBIT_API_KEY_MAINNET',
            'BYBIT_API_SECRET_MAINNET',
            'TELEGRAM_BOT_TOKEN',
            'TELEGRAM_WHITELIST',
          ]),
          this.settings.get('TELEGRAM_USERBOT_MIN_BALANCE_USD'),
        ]);
        const isFilled = (v: string | undefined) => String(v ?? '').trim().length > 0;
        const userbotConnected = userbotConnectedGlobal;
        const setupWarnings: string[] = [];
        if (!userbotConnected) {
          setupWarnings.push('Подключите Userbot (статус должен быть «подключен»).');
        }
        if (enabledGroupsCount < 1) {
          setupWarnings.push('В Userbot включите подписку минимум на 1 группу.');
        }
        if (!isFilled(required.BYBIT_API_KEY_MAINNET)) {
          setupWarnings.push('Заполните: Bybit API key (основной / боевой).');
        }
        if (!isFilled(required.BYBIT_API_SECRET_MAINNET)) {
          setupWarnings.push('Заполните: Bybit API secret (основной / боевой).');
        }
        if (!isFilled(required.TELEGRAM_BOT_TOKEN)) {
          setupWarnings.push('Заполните: Telegram bot token.');
        }
        if (!isFilled(required.TELEGRAM_WHITELIST)) {
          setupWarnings.push('Заполните: Telegram user IDs.');
        }

        if (c.isActive) {
          try {
            const bal = await this.bybit.getUnifiedUsdtBalanceDetails();
            if (bal && Number.isFinite(bal.totalUsd)) {
              totalBalanceUsd = bal.totalUsd;
            }
            if (bal && Number.isFinite(bal.availableUsd)) {
              availableBalanceUsd = bal.availableUsd;
            }
            if (totalBalanceUsd != null) {
              const dayStart = new Date();
              dayStart.setHours(0, 0, 0, 0);
              const dayEnd = new Date(dayStart);
              dayEnd.setDate(dayEnd.getDate() + 1);
              const recentSnapshot = await this.prisma.balanceSnapshot.findFirst({
                where: {
                  cabinetId: c.id,
                  createdAt: { gte: dayStart, lt: dayEnd },
                },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
              });
              const snapshotFresh =
                recentSnapshot != null &&
                Date.now() - recentSnapshot.createdAt.getTime() < 10 * 60_000;
              if (!snapshotFresh) {
                await this.balanceSnapshots
                  .upsertToday(totalBalanceUsd, availableBalanceUsd)
                  .catch((e) => {
                    this.logger.debug(
                      `getDashboardCabinetsOverviewForUser: snapshot upsert cabinet=${c.id}: ${formatError(e)}`,
                    );
                  });
              }
            }
          } catch (e) {
            this.logger.debug(
              `getDashboardCabinetsOverviewForUser: баланс недоступен cabinet=${c.id}: ${formatError(e)}`,
            );
          }
        }

        const minBalanceUsd = parseMinBalanceUsdSetting(
          minBalanceRaw,
          USERBOT_MIN_BALANCE_USD_DEFAULT,
        );
        const balanceGuard = buildDashboardCabinetBalanceGuard({
          minBalanceUsd,
          balanceUsd: availableBalanceUsd,
          totalBalanceUsd,
        });

        const effectiveSetupWarnings = c.isActive ? setupWarnings : [];
        const effectiveBalanceGuard = c.isActive ? balanceGuard : undefined;

        const utilization = await this.getCabinetUtilizationMetrics({
          availableBalanceUsd,
          totalBalanceUsd,
        });

        return {
          cabinetId: c.id,
          slug: c.slug,
          name: c.name,
          isDefault: c.isDefault,
          isActive: c.isActive,
          openSignals: stats.openSignals,
          userbotReadMessagesToday,
          userbotSignalsPlacedToday,
          userbotConnected,
          enabledGroupsCount,
          setupWarnings: effectiveSetupWarnings,
          wins: stats.wins,
          losses: stats.losses,
          winrate: stats.winrate,
          totalPnl: stats.totalPnl,
          totalClosed: stats.totalClosed,
          avgProfitPnl: stats.avgProfitPnl,
          avgLossPnl: stats.avgLossPnl,
          closedPerDayAvg: stats.closedPerDayAvg,
          statsPeriodDays: stats.statsPeriodDays,
          totalBalanceUsd,
          availableBalanceUsd,
          balanceGuard: effectiveBalanceGuard,
          avgSignalExecutionMs: utilization.avgSignalExecutionMs,
          avgIdlePeriodMs: utilization.avgIdlePeriodMs,
          unusedBalanceRatio: utilization.unusedBalanceRatio,
          avgUnusedBalanceRatioMonth: utilization.avgUnusedBalanceRatioMonth,
          utilizationPeriodDays: utilization.utilizationPeriodDays,
        } satisfies DashboardCabinetCardDto;
      }),
    );

    items.sort((a, b) => {
      const aOff = a.isActive === false ? 1 : 0;
      const bOff = b.isActive === false ? 1 : 0;
      return aOff - bOff;
    });

    const summary = buildDashboardCabinetsSummary(items);
    const cabinetIds = cabinets.map((c) => c.id);
    const historyDays = 30;
    const since = new Date(Date.now() - historyDays * 24 * 60 * 60 * 1000);

    let aggregatedBalanceHistory: { at: string; totalUsd: number }[] = [];
    if (cabinetIds.length > 0) {
      const seedRows = await Promise.all(
        cabinetIds.map((cabinetId) =>
          this.prisma.balanceSnapshot.findFirst({
            where: { cabinetId, createdAt: { lt: since } },
            orderBy: { createdAt: 'desc' },
            select: { cabinetId: true, createdAt: true, totalUsd: true },
          }),
        ),
      );
      const seeds = seedRows.filter(
        (r): r is { cabinetId: string; createdAt: Date; totalUsd: number } =>
          r != null && r.cabinetId != null && Number.isFinite(r.totalUsd),
      );
      const inRange = await this.prisma.balanceSnapshot.findMany({
        where: {
          cabinetId: { in: cabinetIds },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'asc' },
        select: { cabinetId: true, createdAt: true, totalUsd: true },
      });
      const inRangeRows = inRange.filter(
        (r): r is { cabinetId: string; createdAt: Date; totalUsd: number } =>
          r.cabinetId != null && Number.isFinite(r.totalUsd),
      );
      /** Без снимков в БД кабинет не попадал в сумму (0) — Σ equity в шапке при этом считался live с Bybit. */
      const merged = [...seeds, ...inRangeRows];
      const cabinetIdsWithSnapshot = new Set(
        merged.map((r) => r.cabinetId).filter((id): id is string => Boolean(id)),
      );
      const now = new Date();
      for (const item of items) {
        const cid = item.cabinetId;
        const bal = item.totalBalanceUsd;
        if (!cid || bal == null || !Number.isFinite(bal)) {
          continue;
        }
        if (!cabinetIdsWithSnapshot.has(cid)) {
          merged.push({ cabinetId: cid, createdAt: since, totalUsd: bal });
        }
        merged.push({ cabinetId: cid, createdAt: now, totalUsd: bal });
      }
      aggregatedBalanceHistory = buildAggregatedBalanceHistoryPoints(
        cabinetIds,
        merged,
        historyDays,
        now,
      );
    }

    const result = { items, summary, aggregatedBalanceHistory };
    setCachedDashboardCabinetsOverview(userId, result);
    return result;
  }

  /**
   * Лента событий по всем кабинетам пользователя: userbot (маршруты ingest) и сигналы за окно времени.
   */
  async getDashboardActivityForUser(
    userIdRaw: string | null | undefined,
    params?: { hours?: number; limit?: number },
  ): Promise<{ items: DashboardActivityItemDto[] }> {
    const userId = String(userIdRaw ?? '').trim();
    if (!userId) {
      return { items: [] };
    }
    const hoursRaw = params?.hours ?? 24;
    const hours = Math.min(Math.max(Number.isFinite(hoursRaw) ? Math.trunc(hoursRaw) : 24, 1), 168);
    const limitRaw = params?.limit ?? 80;
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 80, 1), 150);
    const since = new Date(Date.now() - hours * 3600 * 1000);

    const cabinets = await this.cabinets.listCabinetsForUser(userId);
    const cabinetIds = cabinets.map((c) => c.id);
    const nameById = new Map(cabinets.map((c) => [c.id, c.name]));
    if (cabinetIds.length === 0) {
      return { items: [] };
    }

    const [routes, signals] = await Promise.all([
      this.prisma.cabinetIngestRoute.findMany({
        where: {
          cabinetId: { in: cabinetIds },
          updatedAt: { gte: since },
          status: { in: [...DASHBOARD_ACTIVITY_INGEST_STATUSES] },
        },
        orderBy: { updatedAt: 'desc' },
        take: Math.min(100, limit + 40),
        select: {
          cabinetId: true,
          status: true,
          error: true,
          updatedAt: true,
          createdAt: true,
          chatId: true,
          signalId: true,
          ingest: { select: { messageId: true, text: true } },
        },
      }),
      this.prisma.signal.findMany({
        where: {
          cabinetId: { in: cabinetIds },
          deletedAt: null,
          OR: [{ createdAt: { gte: since } }, { closedAt: { gte: since } }],
        },
        orderBy: { updatedAt: 'desc' },
        take: 120,
        select: {
          id: true,
          cabinetId: true,
          pair: true,
          direction: true,
          status: true,
          realizedPnl: true,
          source: true,
          createdAt: true,
          closedAt: true,
        },
      }),
    ]);

    const signalIds = [
      ...new Set(
        routes.map((r) => r.signalId).filter((id): id is string => Boolean(id && id.trim())),
      ),
    ];
    const signalMeta =
      signalIds.length > 0
        ? await this.prisma.signal.findMany({
            where: { id: { in: signalIds } },
            select: { id: true, pair: true, direction: true },
          })
        : [];
    const pairBySignalId = new Map(
      signalMeta.map((s) => [s.id, { pair: s.pair, direction: s.direction }]),
    );

    const out: DashboardActivityItemDto[] = [];

    for (const r of routes) {
      const cabName = r.cabinetId ? nameById.get(r.cabinetId) ?? 'Кабинет' : 'Кабинет';
      const linked = r.signalId ? pairBySignalId.get(r.signalId) : undefined;
      out.push(
        mapIngestRouteToActivity({
          cabinetId: r.cabinetId,
          cabinetName: cabName,
          status: r.status,
          chatId: r.chatId,
          messageId: r.ingest?.messageId ?? null,
          textPreview: r.ingest?.text ?? '',
          error: r.error,
          updatedAt: r.updatedAt,
          pair: linked?.pair ?? null,
          direction: linked?.direction ?? null,
        }),
      );
    }

    const closedStatuses = new Set(['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED']);

    for (const s of signals) {
      const cid = s.cabinetId;
      if (!cid) continue;
      const cabName = nameById.get(cid) ?? 'Кабинет';
      if (s.createdAt >= since) {
        out.push(
          mapSignalOpenToActivity({
            cabinetId: cid,
            cabinetName: cabName,
            pair: s.pair,
            direction: s.direction,
            status: s.status,
            source: s.source,
            createdAt: s.createdAt,
          }),
        );
      }
      if (
        s.closedAt &&
        s.closedAt >= since &&
        closedStatuses.has(String(s.status ?? '').trim())
      ) {
        out.push(
          mapSignalCloseToActivity({
            cabinetId: cid,
            cabinetName: cabName,
            pair: s.pair,
            direction: s.direction,
            status: s.status,
            realizedPnl: s.realizedPnl,
            closedAt: s.closedAt,
          }),
        );
      }
    }

    out.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const dedup = new Set<string>();
    const merged: DashboardActivityItemDto[] = [];
    for (const row of out) {
      const key = `${row.kind}|${row.at}|${row.cabinetId}|${row.title}|${row.subtitle ?? ''}`;
      if (dedup.has(key)) continue;
      dedup.add(key);
      merged.push(row);
      if (merged.length >= limit) break;
    }

    return { items: merged };
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
        statsPeriodDays: 1,
      };
    }
    const closed = await this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
        ...(statsResetAt ? { closedAt: { gte: statsResetAt } } : {}),
        ...(source ? { source } : {}),
      }),
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
    const liquidationRows = closedFiltered.filter((s) => s.liquidation === true);
    const liquidationTotal = liquidationRows.length;
    const liquidationBySourceMap = new Map<string, number>();
    const liquidationByLeverageMap = new Map<string, number>();
    for (const row of liquidationRows) {
      const sourceKey = (row.source ?? '—').trim() || '—';
      liquidationBySourceMap.set(
        sourceKey,
        (liquidationBySourceMap.get(sourceKey) ?? 0) + 1,
      );
      const lev =
        row.liquidationLeverage != null &&
        Number.isFinite(row.liquidationLeverage)
          ? String(Math.max(1, Math.round(row.liquidationLeverage)))
          : '—';
      liquidationByLeverageMap.set(
        lev,
        (liquidationByLeverageMap.get(lev) ?? 0) + 1,
      );
    }
    const liquidationBySource = Array.from(liquidationBySourceMap.entries())
      .map(([sourceName, count]) => ({
        source: sourceName === '—' ? null : sourceName,
        count,
      }))
      .sort((a, b) => b.count - a.count || (a.source ?? '—').localeCompare(b.source ?? '—', 'ru'));
    const liquidationByLeverage = Array.from(liquidationByLeverageMap.entries())
      .map(([leverage, count]) => ({
        leverage: leverage === '—' ? null : Number(leverage),
        count,
      }))
      .sort((a, b) => b.count - a.count || (b.leverage ?? -1) - (a.leverage ?? -1));

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
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: ['PENDING', 'ORDERS_PLACED', 'OPEN', 'PARSED'] },
        ...(statsResetAt ? { createdAt: { gte: statsResetAt } } : {}),
        ...(source ? { source } : {}),
      }),
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
      statsPeriodDays: days,
      liquidationTotal,
      liquidationBySource,
      liquidationByLeverage,
    };
  }

  /**
   * Снимок для ежедневного дайджеста: окно 24 ч по `closedAt`, кумулятив до окна, итоги как в дашборде.
   * Учитывает `SOURCE_EXCLUDE_LIST` и `STATS_RESET_AT` так же, как `getDashboardStats`.
   */
  async getDailyDigestModel(): Promise<OrdersDailyDigestModel> {
    const now = new Date();
    const from = new Date(now.getTime() - 86_400_000);
    const excluded = await this.getExcludedSourcesSet();
    const statsResetAt = await this.getStatsResetAt();
    const fromEff =
      statsResetAt && statsResetAt.getTime() > from.getTime() ? statsResetAt : from;

    const closedWindowRows = await this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
        closedAt: {
          not: null,
          gte: fromEff,
          lt: now,
        },
      }),
      select: {
        pair: true,
        direction: true,
        status: true,
        realizedPnl: true,
        closedAt: true,
        source: true,
      },
      orderBy: { closedAt: 'desc' },
      take: 80,
    });
    const closedWindowFiltered = closedWindowRows.filter(
      (row) => !excluded.has(String(row.source ?? '')),
    );

    let wins = 0;
    let losses = 0;
    let mixed = 0;
    let totalPnlWindow = 0;
    for (const r of closedWindowFiltered) {
      if (r.status === 'CLOSED_WIN') wins += 1;
      else if (r.status === 'CLOSED_LOSS') losses += 1;
      else if (r.status === 'CLOSED_MIXED') mixed += 1;
      totalPnlWindow += r.realizedPnl ?? 0;
    }
    const decided = wins + losses;
    const winrateWindow = decided === 0 ? 0 : (wins / decided) * 100;

    const beforeRows = await this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
        closedAt: statsResetAt
          ? { not: null, lt: fromEff, gte: statsResetAt }
          : { not: null, lt: fromEff },
      }),
      select: { status: true, realizedPnl: true, source: true },
    });
    const beforeFiltered = beforeRows.filter((row) => !excluded.has(String(row.source ?? '')));
    let bw = 0;
    let bl = 0;
    let beforePnl = 0;
    for (const r of beforeFiltered) {
      if (r.status === 'CLOSED_WIN') bw += 1;
      else if (r.status === 'CLOSED_LOSS') bl += 1;
      beforePnl += r.realizedPnl ?? 0;
    }
    const beforeDecided = bw + bl;
    const winrateBefore =
      beforeDecided === 0 ? 0 : computeWinratePercent(bw, bl);

    const overallFull = await this.getDashboardStats();
    const overall = {
      winrate: overallFull.winrate,
      wins: overallFull.wins,
      losses: overallFull.losses,
      totalClosed: overallFull.totalClosed,
      totalPnl: overallFull.totalPnl,
      openSignals: overallFull.openSignals,
    };

    const cumulativeBeforeWindow = {
      wins: bw,
      losses: bl,
      decided: beforeDecided,
      winrate: winrateBefore,
      totalPnl: beforePnl,
    };

    const deltaPnlVsBefore = overall.totalPnl - cumulativeBeforeWindow.totalPnl;
    const deltaWinratePoints = overall.winrate - cumulativeBeforeWindow.winrate;

    return {
      rolling24h: {
        from: fromEff,
        to: now,
        wins,
        losses,
        mixed,
        decided,
        winrate: winrateWindow,
        totalPnl: totalPnlWindow,
        trades: closedWindowFiltered.slice(0, 15).map((r) => ({
          pair: r.pair,
          direction: r.direction,
          status: r.status,
          realizedPnl: r.realizedPnl,
          closedAt: r.closedAt,
          source: r.source,
        })),
      },
      cumulativeBeforeWindow,
      overall,
      deltaPnlVsBefore,
      deltaWinratePoints,
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
      where: this.withCabinetScope({
        deletedAt: null,
        closedAt: { not: null },
        realizedPnl: { not: null },
        ...(statsResetAt ? { closedAt: { gte: statsResetAt } } : {}),
        ...(source ? { source } : {}),
      }),
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

  private async buildMartingaleStepBySignalId(
    items: Array<{ id: string; source: string | null; createdAt: Date }>,
  ): Promise<Map<string, number>> {
    const stepBySignalId = new Map<string, number>();
    if (items.length === 0) {
      return stepBySignalId;
    }

    const perSource = new Map<string, { maxCreatedAt: Date; trades: typeof items }>();
    for (const item of items) {
      if (!item.source || item.source.trim().length === 0) {
        stepBySignalId.set(item.id, 0);
        continue;
      }
      const bucket = perSource.get(item.source);
      if (!bucket) {
        perSource.set(item.source, { maxCreatedAt: item.createdAt, trades: [item] });
        continue;
      }
      if (item.createdAt > bucket.maxCreatedAt) {
        bucket.maxCreatedAt = item.createdAt;
      }
      bucket.trades.push(item);
    }

    const sourceEntries = Array.from(perSource.entries());
    await Promise.all(
      sourceEntries.map(async ([source, state]) => {
        const closedRows = await this.prisma.signal.findMany({
          where: this.withCabinetScope({
            deletedAt: null,
            source,
            status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
            OR: [
              { closedAt: { not: null, lte: state.maxCreatedAt } },
              { closedAt: null, createdAt: { lte: state.maxCreatedAt } },
            ],
          }),
          select: {
            status: true,
            realizedPnl: true,
            createdAt: true,
            closedAt: true,
          },
          orderBy: [{ closedAt: 'asc' }, { createdAt: 'asc' }],
        });

        const history = closedRows.map((row) => ({
          status: row.status,
          realizedPnl: row.realizedPnl,
          ts: row.closedAt ?? row.createdAt,
        }));
        const tradesAsc = [...state.trades].sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
        );
        let idx = 0;
        let streak = 0;
        for (const trade of tradesAsc) {
          while (idx < history.length && history[idx]!.ts <= trade.createdAt) {
            const ev = history[idx]!;
            streak = isClosedLossOutcome(ev.status, ev.realizedPnl) ? streak + 1 : 0;
            idx += 1;
          }
          stepBySignalId.set(trade.id, streak);
        }
      }),
    );

    return stepBySignalId;
  }

  private async getExcludedSourcesSet(): Promise<Set<string>> {
    const raw = await this.settings.get('SOURCE_EXCLUDE_LIST');
    return new Set(parseStringList(raw));
  }

  private async getStatsResetAt(): Promise<Date | undefined> {
    const raw = await this.settings.get('STATS_RESET_AT');
    if (!raw || raw.trim() === '') {
      return undefined;
    }
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }

  private async getCabinetUtilizationMetrics(params?: {
    availableBalanceUsd?: number | null;
    totalBalanceUsd?: number | null;
  }): Promise<DashboardCabinetUtilizationMetrics> {
    const excluded = await this.getExcludedSourcesSet();
    const statsResetAt = await this.getStatsResetAt();
    const nowMs = Date.now();
    const dayMs = 86_400_000;
    const cabinetId = this.currentCabinetId() ?? (await this.cabinets.getDefaultCabinetId());

    const closedRows = await this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { in: [...DASHBOARD_CLOSED_SIGNAL_STATUSES] },
        closedAt: {
          not: null,
          ...(statsResetAt ? { gte: statsResetAt } : {}),
        },
      }),
      select: { createdAt: true, closedAt: true, source: true },
    });
    const closedFiltered = filterSignalsByExcludedSources(closedRows, excluded);

    const timelineRows = await this.prisma.signal.findMany({
      where: this.withCabinetScope({
        deletedAt: null,
        status: { not: 'FAILED' },
      }),
      select: { createdAt: true, closedAt: true, source: true, status: true },
    });
    const timelineFiltered = filterSignalsByExcludedSources(timelineRows, excluded);

    let windowStartMs = statsResetAt?.getTime() ?? null;
    if (windowStartMs == null) {
      const closedStarts = closedFiltered
        .map((row) => row.createdAt.getTime())
        .filter((ms) => Number.isFinite(ms));
      const timelineStarts = timelineFiltered
        .map((row) => row.createdAt.getTime())
        .filter((ms) => Number.isFinite(ms));
      const candidates = [...closedStarts, ...timelineStarts];
      windowStartMs = candidates.length > 0 ? Math.min(...candidates) : nowMs;
    }

    const occupancySignals = timelineFiltered
      .filter((row) => {
        const startMs = row.createdAt.getTime();
        const isActive = DASHBOARD_ACTIVE_SIGNAL_STATUSES.includes(
          row.status as (typeof DASHBOARD_ACTIVE_SIGNAL_STATUSES)[number],
        );
        const endMs =
          row.closedAt instanceof Date && !Number.isNaN(row.closedAt.getTime())
            ? row.closedAt.getTime()
            : isActive
              ? nowMs
              : null;
        if (endMs == null || !Number.isFinite(startMs)) return false;
        return startMs < nowMs && endMs > windowStartMs;
      })
      .map((row) => ({
        createdAt: row.createdAt,
        closedAt:
          row.closedAt instanceof Date && !Number.isNaN(row.closedAt.getTime())
            ? row.closedAt
            : null,
      }));

    const utilizationPeriodDays = Math.max(1, Math.ceil((nowMs - windowStartMs) / dayMs));
    const avgSignalExecutionMs = computeAvgSignalExecutionMs(closedFiltered);
    const avgIdlePeriodMs = computeAvgIdlePeriodMs(occupancySignals, windowStartMs, nowMs);

    const snapshotSince = new Date(nowMs - 30 * dayMs);
    const snapshots = await this.prisma.balanceSnapshot.findMany({
      where: { cabinetId, createdAt: { gte: snapshotSince } },
      select: { totalUsd: true, availableUsd: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    return {
      avgSignalExecutionMs,
      avgIdlePeriodMs,
      unusedBalanceRatio: computeUnusedBalanceRatio(
        params?.availableBalanceUsd,
        params?.totalBalanceUsd,
      ),
      avgUnusedBalanceRatioMonth: computeAvgUnusedBalanceRatioMonth(snapshots, 30),
      utilizationPeriodDays,
    };
  }

  async resetAnalyticsStats() {
    const resetAt = new Date();
    /** Per-cabinet: `STATS_RESET_AT` в `CabinetSetting` (см. CABINET_SCOPED_SETTING_KEYS). */
    await this.settings.set('STATS_RESET_AT', resetAt.toISOString());
    invalidateDashboardCabinetsOverviewCache();
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
      where: this.withCabinetScope({
        deletedAt: null,
        ...(source ? { source } : {}),
      }),
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
      if (
        row.status === 'PENDING' ||
        row.status === 'ORDERS_PLACED' ||
        row.status === 'OPEN' ||
        row.status === 'PARSED'
      ) {
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
      minClosedAt: Date | null;
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
          minClosedAt: null,
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
        r.status === 'PENDING' ||
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
        if (r.closedAt instanceof Date && !Number.isNaN(r.closedAt.getTime())) {
          const t = r.closedAt.getTime();
          if (!acc.minClosedAt || t < acc.minClosedAt.getTime()) {
            acc.minClosedAt = r.closedAt;
          }
        }
      }

      map.set(key, acc);
    }

    const nowMs = Date.now();
    const dayMs = 86_400_000;
    const resetMs = statsResetAt?.getTime();

    const items = Array.from(map.entries())
      .map(([, acc]) => {
        const firstCloseMs =
          acc.minClosedAt instanceof Date && !Number.isNaN(acc.minClosedAt.getTime())
            ? acc.minClosedAt.getTime()
            : null;
        const startMs =
          firstCloseMs != null
            ? Math.max(firstCloseMs, resetMs ?? firstCloseMs)
            : resetMs ?? nowMs;
        const statsPeriodDays = Math.max(1, Math.ceil((nowMs - startMs) / dayMs));
        return {
          source: acc.source,
          winrate: computeWinratePercent(acc.wins, acc.losses),
          wins: acc.wins,
          losses: acc.losses,
          wL: `${acc.wins} / ${acc.losses}`,
          totalClosed: acc.closedTotal,
          openSignals: acc.openTotal,
          totalPnl: acc.totalPnl,
          statsPeriodDays,
        };
      })
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
    const sortBy = f.sortBy === 'closedAt' ? 'closedAt' : 'createdAt';
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
    const refreshPnlFromExchange = f.refreshPnlFromExchange === true;
    const includeMartingaleSteps = f.includeMartingaleSteps === true;

    const [items, total] = await Promise.all([
      this.prisma.signal.findMany({
        where: this.withCabinetScope(where),
        orderBy:
          sortBy === 'closedAt'
            ? [{ closedAt: 'desc' }, { createdAt: 'desc' }]
            : [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          cabinet: { select: { name: true, slug: true } },
          orders: true,
          events: {
            orderBy: { createdAt: 'desc' },
            take: 8,
          },
        },
      }),
      this.prisma.signal.count({ where: this.withCabinetScope(where) }),
    ]);

    let itemsBase = items.map((item) => ({ ...item }));
    if (includeMartingaleSteps) {
      const martingaleStepById = await this.buildMartingaleStepBySignalId(
        items.map((item) => ({
          id: item.id,
          source: item.source,
          createdAt: item.createdAt,
        })),
      );
      itemsBase = items.map((item) => ({
        ...item,
        martingaleStep: martingaleStepById.get(item.id) ?? 0,
      }));
    }

    if (!refreshPnlFromExchange) {
      return {
        items: itemsBase.map((item) => ({
          ...this.toTradeListClientRow(item),
          finalPnl: item.realizedPnl ?? null,
          pnlBreakdown: null,
        })),
        total,
        page,
        pageSize,
      };
    }

    const itemsWithPnlBreakdown = await Promise.all(
      itemsBase.map(async (item) => {
        let finalPnl = item.realizedPnl;
        let pnlBreakdown: {
          source: 'closed_pnl' | 'execution_fallback' | 'unavailable';
          requestWindow: {
            startTime: number;
            endTime: number;
          };
          grossPnl: number | null;
          fees: {
            openFee: number | null;
            closeFee: number | null;
            execFee: number | null;
            total: number | null;
          };
          details?: string;
          error?: string;
        } | null = null;

        if (OrdersService.CLOSED_STATUSES.has(item.status)) {
          const breakdown = await this.bybit.getTradePnlBreakdown(item.id);
          finalPnl = breakdown.finalPnl ?? item.realizedPnl;
          pnlBreakdown = {
            source: breakdown.source,
            requestWindow: breakdown.requestWindow,
            grossPnl: breakdown.grossPnl,
            fees: breakdown.fees,
            details: breakdown.details,
            error: breakdown.error,
          };

          if (typeof finalPnl === 'number' && Number.isFinite(finalPnl)) {
            const shouldUpdateRealized =
              item.realizedPnl === null ||
              item.realizedPnl === undefined ||
              Math.abs(item.realizedPnl - finalPnl) > 1e-9;
            const nextStatus =
              finalPnl > 0 ? 'CLOSED_WIN' : finalPnl < 0 ? 'CLOSED_LOSS' : 'CLOSED_MIXED';
            const shouldUpdateStatus = item.status !== nextStatus;
            if (shouldUpdateRealized || shouldUpdateStatus) {
              await this.prisma.signal.updateMany({
                where: this.withCabinetScope({ id: item.id }),
                data: {
                  realizedPnl: finalPnl,
                  status: nextStatus,
                },
              });
            }
          }
        }

        return {
          ...this.toTradeListClientRow(item),
          finalPnl,
          pnlBreakdown,
        };
      }),
    );

    return { items: itemsWithPnlBreakdown, total, page, pageSize };
  }

  async statsBySource() {
    const rows = await this.prisma.signal.groupBy({
      by: ['source', 'status'],
      _count: { id: true },
      where: this.withCabinetScope({ deletedAt: null }),
    });
    return rows;
  }

  async listDistinctSources(): Promise<string[]> {
    const excluded = await this.getExcludedSourcesSet();
    const rows = await this.prisma.signal.groupBy({
      by: ['source'],
      _count: { id: true },
      where: this.withCabinetScope({
        deletedAt: null,
        source: { not: null },
      }),
    });

    return rows
      .map((r) => r.source)
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .filter((v) => !excluded.has(v))
      .sort((a, b) => a.localeCompare(b, 'ru'));
  }

  async getLatestClosedSignalBySource(source: string) {
    const s = source.trim();
    if (!s) {
      return null;
    }
    return this.prisma.signal.findFirst({
      where: this.withCabinetScope({
        deletedAt: null,
        source: s,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
      }),
      orderBy: [{ closedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        status: true,
        realizedPnl: true,
        closedAt: true,
      },
    });
  }

  async statsByPair() {
    const rows = await this.prisma.signal.groupBy({
      by: ['pair', 'status'],
      _count: { id: true },
      where: this.withCabinetScope({ deletedAt: null }),
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
