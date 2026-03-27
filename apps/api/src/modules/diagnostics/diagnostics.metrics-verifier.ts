import { Injectable } from '@nestjs/common';

import type { DiagnosticCaseTrace, DiagnosticStepAudit } from './diagnostics.types';

@Injectable()
export class DiagnosticsMetricsVerifier {
  verify(trace: DiagnosticCaseTrace): DiagnosticStepAudit {
    const issues: string[] = [];
    const evidence: string[] = [];
    const fixes: string[] = [];

    const signal = trace.signal as
      | {
          status?: string | null;
          realizedPnl?: number | null;
          closedAt?: string | null;
          orders?: unknown[];
        }
      | null
      | undefined;

    const dashboard = trace.metricsSnapshot.dashboard as
      | {
          totalClosed?: number;
          wins?: number;
          losses?: number;
          openSignals?: number;
        }
      | null
      | undefined;

    evidence.push(`ingest.status=${trace.ingest.status}`);
    evidence.push(`ingest.classification=${trace.ingest.classification}`);

    if (!signal) {
      issues.push('Связанный signal не найден для ingest-кейса.');
      fixes.push(
        'Проверьте связку messageId/sourceMessageId и логику создания signal после распознавания.',
      );
    } else {
      const status = String(signal.status ?? '');
      const pnl = typeof signal.realizedPnl === 'number' ? signal.realizedPnl : null;
      const hasClosedAt = Boolean(signal.closedAt);
      const orderCount = Array.isArray(signal.orders) ? signal.orders.length : 0;

      evidence.push(`signal.status=${status}`);
      evidence.push(`signal.orders=${orderCount}`);

      if ((status === 'ORDERS_PLACED' || status === 'OPEN' || status === 'PARSED') && hasClosedAt) {
        issues.push('У активного сигнала заполнено closedAt.');
      }
      if (status === 'CLOSED_WIN' && (pnl === null || pnl <= 0)) {
        issues.push('CLOSED_WIN ожидает положительный realizedPnl.');
      }
      if (status === 'CLOSED_LOSS' && (pnl === null || pnl >= 0)) {
        issues.push('CLOSED_LOSS ожидает отрицательный realizedPnl.');
      }
      if (status === 'ORDERS_PLACED' && orderCount === 0) {
        issues.push('У сигнала ORDERS_PLACED нет связанных ордеров в БД.');
      }
      if (status.startsWith('CLOSED_') && !hasClosedAt) {
        issues.push('Закрытый сигнал без closedAt.');
      }

      const statsResetAtRaw = trace.settingsSnapshot.STATS_RESET_AT;
      const statsResetAt =
        typeof statsResetAtRaw === 'string' && statsResetAtRaw.trim()
          ? new Date(statsResetAtRaw)
          : null;
      const resetAtMs =
        statsResetAt && !Number.isNaN(statsResetAt.getTime())
          ? statsResetAt.getTime()
          : null;
      const excludedRaw = trace.settingsSnapshot.SOURCE_EXCLUDE_LIST;
      const excludedSources = this.parseStringList(excludedRaw);
      const signalSource =
        trace.signal &&
        typeof trace.signal === 'object' &&
        !Array.isArray(trace.signal) &&
        typeof (trace.signal as { source?: unknown }).source === 'string'
          ? String((trace.signal as { source?: unknown }).source).trim()
          : '';
      const isExcluded = signalSource.length > 0 && excludedSources.includes(signalSource);
      const closedAtMs =
        typeof signal.closedAt === 'string' && signal.closedAt
          ? new Date(signal.closedAt).getTime()
          : null;
      const eligibleForClosedStats =
        !isExcluded &&
        (status === 'CLOSED_WIN' || status === 'CLOSED_LOSS' || status === 'CLOSED_MIXED') &&
        (closedAtMs == null || resetAtMs == null || closedAtMs >= resetAtMs);
      const eligibleForOpenStats =
        !isExcluded &&
        (status === 'ORDERS_PLACED' || status === 'OPEN' || status === 'PARSED');

      if (dashboard && eligibleForClosedStats) {
        if (status === 'CLOSED_WIN' && Number(dashboard.wins ?? 0) <= 0) {
          issues.push('Закрытый win-сигнал не отражён в wins дашборда.');
        }
        if (status === 'CLOSED_LOSS' && Number(dashboard.losses ?? 0) <= 0) {
          issues.push('Закрытый loss-сигнал не отражён в losses дашборда.');
        }
      }

      if (dashboard && eligibleForOpenStats && Number(dashboard.openSignals ?? 0) <= 0) {
        issues.push('Активный сигнал не отражён в openSignals дашборда.');
      }

      if (
        eligibleForClosedStats &&
        closedAtMs != null &&
        !Number.isNaN(closedAtMs) &&
        (status === 'CLOSED_WIN' || status === 'CLOSED_LOSS') &&
        typeof pnl === 'number'
      ) {
        const d = new Date(closedAtMs);
        const dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate(),
        ).padStart(2, '0')}`;
        const pnlSeries = Array.isArray(trace.metricsSnapshot.pnlSeriesDay)
          ? trace.metricsSnapshot.pnlSeriesDay
          : [];
        const hasBucket = pnlSeries.some((point) => {
          if (!point || typeof point !== 'object' || Array.isArray(point)) return false;
          return String((point as { date?: unknown }).date ?? '') === dateKey;
        });
        if (!hasBucket) {
          issues.push(`Для закрытой сделки отсутствует дневной pnl bucket ${dateKey}.`);
        }
      }
    }

    return {
      stepKey: 'metrics_consistency_verifier',
      status: issues.length > 0 ? 'warning' : 'ok',
      comment:
        issues.length > 0
          ? 'Найдены потенциальные расхождения по консистентности сигнала/метрик.'
          : 'Базовая верификация консистентности сигнала и метрик пройдена.',
      issues,
      evidence,
      missingContext: [],
      recommendedFixes: fixes,
    };
  }

  private parseStringList(raw: string | null | undefined): string[] {
    const text = String(raw ?? '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((v) => (typeof v === 'string' ? v.trim() : ''))
          .filter((v) => v.length > 0);
      }
    } catch {
      // ignore
    }
    return text
      .split(/[\n,]/g)
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
}
