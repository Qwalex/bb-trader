import { Injectable } from '@nestjs/common';
import { OpenRouter } from '@openrouter/sdk';

import { PrismaService } from '../../prisma/prisma.service';
import { BybitService } from '../bybit/bybit.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';
import { arrStrings, parseJsonObject, parseStringList } from './diagnostics.utils';

const OPENROUTER_SITE_URL = 'https://signals-bot.local';
const OPENROUTER_APP_TITLE = 'SignalsBot AI Advisor';

const ADVISOR_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    globalRecommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: {
            type: 'string',
            enum: ['entry_size', 'leverage', 'risk_management'],
          },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          recommendation: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['area', 'priority', 'recommendation', 'rationale'],
        additionalProperties: false,
      },
    },
    groupRecommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          groupName: { type: 'string' },
          area: {
            type: 'string',
            enum: ['entry_size', 'leverage', 'risk_management'],
          },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
          recommendation: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['groupName', 'area', 'priority', 'recommendation', 'rationale'],
        additionalProperties: false,
      },
    },
    alerts: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'globalRecommendations', 'groupRecommendations', 'alerts'],
  additionalProperties: false,
} as const;

type AdviceArea = 'entry_size' | 'leverage' | 'risk_management';
type AdvicePriority = 'high' | 'medium' | 'low';

@Injectable()
export class TradingAiAdvisorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly orders: OrdersService,
    private readonly bybit: BybitService,
  ) {}

  async generateAdvice(params?: { closedLimit?: number }) {
    const apiKey = (await this.settings.get('OPENROUTER_API_KEY'))?.trim();
    if (!apiKey) {
      return {
        ok: false,
        error: 'OPENROUTER_API_KEY не задан. Добавьте ключ в настройках.',
      };
    }

    const model = (await this.settings.get('OPENROUTER_MODEL_AI_ADVISOR'))?.trim();
    if (!model) {
      return {
        ok: false,
        error:
          'Не задана отдельная модель для AI рекомендаций (OPENROUTER_MODEL_AI_ADVISOR).',
      };
    }

    const context = await this.buildContext({
      closedLimit: params?.closedLimit,
    });

    const client = new OpenRouter({
      apiKey,
      httpReferer: OPENROUTER_SITE_URL,
      xTitle: OPENROUTER_APP_TITLE,
      timeoutMs: 180_000,
    });

    const systemPrompt = [
      'Ты риск-менеджер и системный трейдинг-аналитик.',
      'Твоя задача: дать практические рекомендации по настройкам входа, плеча и риск-менеджменту.',
      'Используй только данные из переданного JSON-контекста.',
      'Не выдумывай факты и не обещай доходность.',
      'Ответы пиши только на русском языке.',
      'Фокус: минимизация просадки, стабильность, контроль риска.',
      'Пиши конкретно: что менять и почему, без воды.',
      'Верни ТОЛЬКО JSON по схеме.',
    ].join('\n');

    const res = await client.chat.send({
      httpReferer: OPENROUTER_SITE_URL,
      xTitle: OPENROUTER_APP_TITLE,
      chatGenerationParams: {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(context) },
        ] as never,
        responseFormat: {
          type: 'json_schema',
          jsonSchema: {
            name: 'trading_ai_advice',
            strict: true,
            schema: ADVISOR_RESPONSE_JSON_SCHEMA,
          },
        },
        stream: false,
      },
    });

    const rawContent = res.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      return { ok: false, error: 'Пустой ответ от AI-модели.' };
    }
    const parsed = parseJsonObject(rawContent);
    if (!parsed) {
      return { ok: false, error: 'AI вернул невалидный JSON.' };
    }

    const normalizeArea = (raw: unknown): AdviceArea => {
      const v = String(raw ?? '').trim();
      if (v === 'entry_size' || v === 'leverage' || v === 'risk_management') {
        return v;
      }
      return 'risk_management';
    };
    const normalizePriority = (raw: unknown): AdvicePriority => {
      const v = String(raw ?? '').trim();
      if (v === 'high' || v === 'medium' || v === 'low') {
        return v;
      }
      return 'medium';
    };

    const globalRecommendations = Array.isArray(parsed.globalRecommendations)
      ? parsed.globalRecommendations
          .map((row) => {
            const o =
              row && typeof row === 'object' && !Array.isArray(row)
                ? (row as Record<string, unknown>)
                : null;
            if (!o) return null;
            return {
              area: normalizeArea(o.area),
              priority: normalizePriority(o.priority),
              recommendation: String(o.recommendation ?? '').trim(),
              rationale: String(o.rationale ?? '').trim(),
            };
          })
          .filter(
            (
              row,
            ): row is {
              area: AdviceArea;
              priority: AdvicePriority;
              recommendation: string;
              rationale: string;
            } =>
              row != null &&
              row.recommendation.length > 0 &&
              row.rationale.length > 0,
          )
      : [];

    const groupRecommendations = Array.isArray(parsed.groupRecommendations)
      ? parsed.groupRecommendations
          .map((row) => {
            const o =
              row && typeof row === 'object' && !Array.isArray(row)
                ? (row as Record<string, unknown>)
                : null;
            if (!o) return null;
            return {
              groupName: String(o.groupName ?? '').trim() || 'Неизвестная группа',
              area: normalizeArea(o.area),
              priority: normalizePriority(o.priority),
              recommendation: String(o.recommendation ?? '').trim(),
              rationale: String(o.rationale ?? '').trim(),
            };
          })
          .filter(
            (
              row,
            ): row is {
              groupName: string;
              area: AdviceArea;
              priority: AdvicePriority;
              recommendation: string;
              rationale: string;
            } =>
              row != null &&
              row.recommendation.length > 0 &&
              row.rationale.length > 0,
          )
      : [];

    return {
      ok: true,
      model,
      summary: String(parsed.summary ?? '').trim(),
      alerts: arrStrings(parsed.alerts),
      globalRecommendations,
      groupRecommendations,
      contextMeta: context.meta,
      usage: {
        inputTokens: Number(res.usage?.promptTokens ?? 0) || undefined,
        outputTokens: Number(res.usage?.completionTokens ?? 0) || undefined,
        totalTokens: Number(res.usage?.totalTokens ?? 0) || undefined,
      },
    };
  }

  private async buildContext(params?: { closedLimit?: number }) {
    const closedLimit = Math.min(Math.max(params?.closedLimit ?? 600, 100), 4000);
    const closedSignals = await this.prisma.signal.findMany({
      where: {
        deletedAt: null,
        status: { in: ['CLOSED_WIN', 'CLOSED_LOSS', 'CLOSED_MIXED'] },
      },
      orderBy: { closedAt: 'desc' },
      take: closedLimit,
      select: {
        id: true,
        source: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        status: true,
        realizedPnl: true,
        createdAt: true,
        closedAt: true,
      },
    });

    const [
      dashboardStats,
      bySourceStats,
      topSources,
      chats,
      settingsMany,
      sourceListRaw,
      sourceExcludeRaw,
      balanceDetails,
    ] = await Promise.all([
      this.orders.getDashboardStats(),
      this.orders.getSourceStats(),
      this.orders.getTopSources({ limit: 10 }),
      this.prisma.tgUserbotChat.findMany({
        orderBy: { title: 'asc' },
        select: {
          chatId: true,
          title: true,
          enabled: true,
          defaultLeverage: true,
          defaultEntryUsd: true,
        },
      }),
      this.settings.getMany([
        'DEFAULT_ORDER_USD',
        'DEFAULT_LEVERAGE_ENABLED',
        'DEFAULT_LEVERAGE',
        'MIN_CAPITAL_AMOUNT',
        'TELEGRAM_USERBOT_MIN_BALANCE_USD',
        'POLLING_INTERVAL_MS',
      ]),
      this.settings.get('SOURCE_LIST'),
      this.settings.get('SOURCE_EXCLUDE_LIST'),
      this.bybit.getUnifiedUsdtBalanceDetails(),
    ]);

    const byLeverage = new Map<
      string,
      { leverage: number; trades: number; wins: number; losses: number; totalPnl: number }
    >();
    const byEntryBand = new Map<
      string,
      { band: string; trades: number; wins: number; losses: number; totalPnl: number }
    >();

    const bandOf = (orderUsd: number): string => {
      if (orderUsd < 10) return '<10';
      if (orderUsd < 25) return '10-25';
      if (orderUsd < 50) return '25-50';
      if (orderUsd < 100) return '50-100';
      return '100+';
    };

    for (const s of closedSignals) {
      const levKey = String(s.leverage);
      const lev = byLeverage.get(levKey) ?? {
        leverage: s.leverage,
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
      };
      lev.trades += 1;
      if (s.status === 'CLOSED_WIN') lev.wins += 1;
      if (s.status === 'CLOSED_LOSS') lev.losses += 1;
      lev.totalPnl += s.realizedPnl ?? 0;
      byLeverage.set(levKey, lev);

      const bandKey = bandOf(s.orderUsd);
      const band = byEntryBand.get(bandKey) ?? {
        band: bandKey,
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
      };
      band.trades += 1;
      if (s.status === 'CLOSED_WIN') band.wins += 1;
      if (s.status === 'CLOSED_LOSS') band.losses += 1;
      band.totalPnl += s.realizedPnl ?? 0;
      byEntryBand.set(bandKey, band);
    }

    const sourceStatsByName = new Map(
      bySourceStats.map((s) => [String(s.source ?? ''), s]),
    );
    const groupConfigs = chats.map((chat) => {
      const sourceStat = sourceStatsByName.get(chat.title) ?? null;
      return {
        groupName: chat.title,
        chatId: chat.chatId,
        enabled: chat.enabled,
        defaultLeverage: chat.defaultLeverage,
        defaultEntryUsd: chat.defaultEntryUsd,
        stats: sourceStat
          ? {
              totalClosed: sourceStat.totalClosed,
              wins: sourceStat.wins,
              losses: sourceStat.losses,
              winrate: Number(sourceStat.winrate.toFixed(2)),
              totalPnl: Number(sourceStat.totalPnl.toFixed(2)),
              openSignals: sourceStat.openSignals,
            }
          : null,
      };
    });

    return {
      meta: {
        generatedAt: new Date().toISOString(),
        closedTradesAnalysed: closedSignals.length,
      },
      globalSettings: {
        defaultOrderUsd: settingsMany.DEFAULT_ORDER_USD ?? null,
        defaultLeverageEnabled: settingsMany.DEFAULT_LEVERAGE_ENABLED ?? null,
        defaultLeverage: settingsMany.DEFAULT_LEVERAGE ?? null,
        minCapitalAmount: settingsMany.MIN_CAPITAL_AMOUNT ?? null,
        userbotMinBalanceUsd: settingsMany.TELEGRAM_USERBOT_MIN_BALANCE_USD ?? null,
        pollingIntervalMs: settingsMany.POLLING_INTERVAL_MS ?? null,
        sourceList: parseStringList(sourceListRaw),
        sourceExcludeList: parseStringList(sourceExcludeRaw),
      },
      accountSnapshot: {
        availableUsd: balanceDetails?.availableUsd ?? null,
        totalUsd: balanceDetails?.totalUsd ?? null,
      },
      tradingStats: {
        ...dashboardStats,
        winrate: Number(dashboardStats.winrate.toFixed(2)),
        totalPnl: Number(dashboardStats.totalPnl.toFixed(2)),
        avgProfitPnl: Number(dashboardStats.avgProfitPnl.toFixed(2)),
        avgLossPnl: Number(dashboardStats.avgLossPnl.toFixed(2)),
      },
      sourceStats: bySourceStats
        .map((row) => ({
          source: row.source ?? '—',
          totalClosed: row.totalClosed,
          wins: row.wins,
          losses: row.losses,
          winrate: Number(row.winrate.toFixed(2)),
          totalPnl: Number(row.totalPnl.toFixed(2)),
          openSignals: row.openSignals,
        }))
        .slice(0, 80),
      topSources,
      leverageStats: Array.from(byLeverage.values())
        .map((row) => ({
          leverage: row.leverage,
          trades: row.trades,
          wins: row.wins,
          losses: row.losses,
          winrate:
            row.wins + row.losses > 0
              ? Number(((row.wins / (row.wins + row.losses)) * 100).toFixed(2))
              : 0,
          totalPnl: Number(row.totalPnl.toFixed(2)),
          avgPnl: row.trades > 0 ? Number((row.totalPnl / row.trades).toFixed(4)) : 0,
        }))
        .sort((a, b) => a.leverage - b.leverage),
      entryBandStats: Array.from(byEntryBand.values()).map((row) => ({
        band: row.band,
        trades: row.trades,
        wins: row.wins,
        losses: row.losses,
        winrate:
          row.wins + row.losses > 0
            ? Number(((row.wins / (row.wins + row.losses)) * 100).toFixed(2))
            : 0,
        totalPnl: Number(row.totalPnl.toFixed(2)),
        avgPnl: row.trades > 0 ? Number((row.totalPnl / row.trades).toFixed(4)) : 0,
      })),
      groupConfigs,
      sampleClosedTrades: closedSignals.slice(0, 150).map((row) => ({
        source: row.source ?? '—',
        leverage: row.leverage,
        orderUsd: row.orderUsd,
        capitalPercent: row.capitalPercent,
        status: row.status,
        realizedPnl: row.realizedPnl,
        closedAt: row.closedAt?.toISOString() ?? null,
      })),
    };
  }
}

