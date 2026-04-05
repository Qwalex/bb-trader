import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { BybitService } from '../bybit/bybit.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';
import { TranscriptService } from '../transcript/transcript.service';
import type { DiagnosticCaseTrace } from './diagnostics.types';

@Injectable()
export class DiagnosticsTraceBuilder {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly bybit: BybitService,
    private readonly orders: OrdersService,
    private readonly transcript: TranscriptService,
  ) {}

  async buildLatestIngestTraces(params: {
    limit: number;
    maxLogLines: number;
    workspaceId: string;
  }): Promise<DiagnosticCaseTrace[]> {
    const ws = params.workspaceId.trim();
    const [rows, dashboard, pnlSeriesDay, settingSnapshot, filterPatterns, filterExamples] =
      await Promise.all([
        this.prisma.tgUserbotIngest.findMany({
          where: { workspaceId: ws },
          orderBy: { createdAt: 'desc' },
          take: params.limit,
        }),
        this.orders.getDashboardStats({ workspaceId: ws }),
        this.orders.getPnlSeries('day', { workspaceId: ws }),
        this.readSettingsSnapshot(ws),
        this.prisma.tgUserbotFilterPattern.findMany({
          where: { workspaceId: ws, enabled: true },
          orderBy: { updatedAt: 'desc' },
          take: 120,
        }),
        this.prisma.tgUserbotFilterExample.findMany({
          where: { workspaceId: ws, enabled: true },
          orderBy: { updatedAt: 'desc' },
          take: 120,
        }),
      ]);

    const traces: DiagnosticCaseTrace[] = [];
    for (const ingest of rows) {
      const signal = await this.prisma.signal.findFirst({
        where: {
          deletedAt: null,
          workspaceId: ws,
          sourceChatId: ingest.chatId,
          sourceMessageId: ingest.messageId,
        },
        include: {
          orders: true,
          events: {
            orderBy: { createdAt: 'asc' },
            take: 100,
          },
        },
      });

      const logs = await this.findRelevantLogs(
        ws,
        ingest.id,
        ingest.chatId,
        ingest.messageId,
        params.maxLogLines,
      );

      let bybitSnapshot: unknown = null;
      if (signal?.id) {
        try {
          bybitSnapshot = await this.bybit.getSignalExecutionDebugSnapshot(signal.id, ws);
        } catch (e) {
          bybitSnapshot = { ok: false, error: String(e) };
        }
      }

      let classificationReplay: unknown = null;
      const text = (ingest.text ?? '').trim();
      if (text.length > 0 && text.length <= 10_000) {
        try {
          classificationReplay = await this.transcript.classifyTradingMessage(text, {
            workspaceId: ws,
          });
        } catch (e) {
          classificationReplay = { ok: false, error: String(e) };
        }
      }

      traces.push({
        ingest: {
          id: ingest.id,
          chatId: ingest.chatId,
          messageId: ingest.messageId,
          classification: ingest.classification,
          status: ingest.status,
          error: ingest.error,
          signalHash: ingest.signalHash,
          createdAt: ingest.createdAt.toISOString(),
          text: ingest.text,
          aiRequest: ingest.aiRequest,
          aiResponse: ingest.aiResponse,
        },
        signal: signal
          ? {
              ...signal,
              createdAt: signal.createdAt.toISOString(),
              updatedAt: signal.updatedAt.toISOString(),
              closedAt: signal.closedAt?.toISOString() ?? null,
              orders: signal.orders.map((o) => ({
                ...o,
                createdAt: o.createdAt.toISOString(),
                updatedAt: o.updatedAt.toISOString(),
                filledAt: o.filledAt?.toISOString() ?? null,
              })),
              events: signal.events.map((ev) => ({
                ...ev,
                createdAt: ev.createdAt.toISOString(),
              })),
            }
          : null,
        logs: logs.map((row) => ({
          id: row.id,
          level: row.level,
          category: row.category,
          message: row.message,
          payload: row.payload,
          createdAt: row.createdAt.toISOString(),
        })),
        settingsSnapshot: settingSnapshot,
        filterPatterns: filterPatterns.map((f) => ({
          id: f.id,
          groupName: f.groupName,
          kind: f.kind,
          pattern: f.pattern,
          requiresQuote: f.requiresQuote,
          enabled: f.enabled,
          updatedAt: f.updatedAt.toISOString(),
        })),
        filterExamples: filterExamples.map((f) => ({
          id: f.id,
          groupName: f.groupName,
          kind: f.kind,
          example: f.example,
          requiresQuote: f.requiresQuote,
          enabled: f.enabled,
          updatedAt: f.updatedAt.toISOString(),
        })),
        bybitSnapshot,
        classificationReplay,
        metricsSnapshot: {
          dashboard,
          pnlSeriesDay,
        },
      });
    }

    return traces;
  }

  private async findRelevantLogs(
    workspaceId: string,
    ingestId: string,
    chatId: string,
    messageId: string,
    maxLogLines: number,
  ) {
    return this.prisma.appLog.findMany({
      where: {
        AND: [
          {
            OR: [{ workspaceId }, { workspaceId: null }],
          },
          {
            category: { in: ['telegram', 'openrouter', 'bybit', 'orders'] },
            OR: [
              { payload: { contains: ingestId } },
              { payload: { contains: `"chatId":"${chatId}"` } },
              { payload: { contains: `"messageId":"${messageId}"` } },
            ],
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: maxLogLines,
    });
  }

  private async readSettingsSnapshot(workspaceId: string): Promise<Record<string, string | null>> {
    const keys = [
      'OPENROUTER_MODEL_DEFAULT',
      'OPENROUTER_MODEL_TEXT',
      'OPENROUTER_MODEL_TEXT_FALLBACK_1',
      'OPENROUTER_DIAGNOSTIC_MODELS',
      'TELEGRAM_USERBOT_ENABLED',
      'TELEGRAM_USERBOT_USE_AI_CLASSIFIER',
      'TELEGRAM_USERBOT_POLL_INTERVAL_MS',
      'TELEGRAM_USERBOT_REQUIRE_CONFIRMATION',
      'TELEGRAM_USERBOT_MIN_BALANCE_USD',
      'BYBIT_TESTNET',
      'DEFAULT_ORDER_USD',
      'DEFAULT_LEVERAGE',
      'SOURCE_EXCLUDE_LIST',
      'STATS_RESET_AT',
    ];

    const rows = await Promise.all(
      keys.map(async (k) => ({ key: k, value: await this.settings.get(k, workspaceId) })),
    );
    const out: Record<string, string | null> = {};
    for (const row of rows) {
      out[row.key] = row.value ?? null;
    }
    return out;
  }
}
