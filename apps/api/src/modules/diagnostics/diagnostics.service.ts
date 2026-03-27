import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import {
  DEFAULT_DIAGNOSTIC_BATCH_SIZE,
  DEFAULT_DIAGNOSTIC_MAX_LOG_LINES,
  DEFAULT_DIAGNOSTIC_MODELS,
  DIAGNOSTIC_BATCH_SIZE_KEY,
  DIAGNOSTIC_MAX_LOG_LINES_KEY,
  DIAGNOSTIC_MODELS_KEY,
} from './diagnostics.constants';
import { DiagnosticsAiService } from './diagnostics.ai.service';
import { DiagnosticsMetricsVerifier } from './diagnostics.metrics-verifier';
import { DiagnosticsTraceBuilder } from './diagnostics.trace-builder';
import type { DiagnosticCaseTrace, DiagnosticStepAudit } from './diagnostics.types';
import { clamp, parseStringList, toFiniteInt, toJsonString } from './diagnostics.utils';
import { SettingsService } from '../settings/settings.service';

type RunLatestParams = {
  limit?: number;
};

@Injectable()
export class DiagnosticsService {
  private runQueue: Promise<void> = Promise.resolve();
  private runningRunId: string | null = null;
  private queuedRunIds = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly traceBuilder: DiagnosticsTraceBuilder,
    private readonly ai: DiagnosticsAiService,
    private readonly metricsVerifier: DiagnosticsMetricsVerifier,
  ) {}

  async runLatestBatch(params?: RunLatestParams) {
    const models = await this.resolveDiagnosticModels();
    if (models.length === 0) {
      return {
        ok: false,
        error:
          'Не заданы модели для диагностики. Заполните OPENROUTER_DIAGNOSTIC_MODELS или OPENROUTER_MODEL_TEXT/DEFAULT.',
      };
    }
    const batchSize = await this.resolveBatchSize(params?.limit);
    const maxLogLines = await this.resolveMaxLogLines();
    const queuedAhead =
      this.runningRunId !== null || this.queuedRunIds.size > 0;

    const run = await this.prisma.diagnosticRun.create({
      data: {
        status: queuedAhead ? 'queued' : 'running',
        modelsJson: JSON.stringify(models),
        requestJson: JSON.stringify({
          requestedLimit: params?.limit ?? null,
          resolvedLimit: batchSize,
          maxLogLines,
        }),
      },
    });

    await this.appendRunLog(run.id, 'info', 'diagnostics', 'run started', {
      models,
      batchSize,
      maxLogLines,
    });
    this.queuedRunIds.add(run.id);
    this.runQueue = this.runQueue
      .catch(() => undefined)
      .then(async () => {
        this.queuedRunIds.delete(run.id);
        this.runningRunId = run.id;
        try {
          if (queuedAhead) {
            await this.prisma.diagnosticRun.update({
              where: { id: run.id },
              data: { status: 'running' },
            });
            await this.appendRunLog(run.id, 'info', 'diagnostics', 'run dequeued and started');
          }
          await this.executeRun(run.id, models, batchSize, maxLogLines);
        } finally {
          if (this.runningRunId === run.id) {
            this.runningRunId = null;
          }
        }
      });

    return this.getRunDetails(run.id);
  }

  async listRuns(limit = 20) {
    const take = clamp(limit, 1, 100);
    const rows = await this.prisma.diagnosticRun.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        status: true,
        caseCount: true,
        summary: true,
        error: true,
        modelsJson: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({
      ...r,
      models: parseStringList(r.modelsJson),
    }));
  }

  async getRunDetails(runId: string) {
    const run = await this.prisma.diagnosticRun.findUnique({
      where: { id: runId },
    });
    if (!run) {
      return { ok: false, error: 'Диагностический прогон не найден' };
    }

    const [cases, modelResults, stepResults, logs] = await Promise.all([
      this.prisma.diagnosticCase.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.diagnosticModelResult.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.diagnosticStepResult.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.diagnosticLog.findMany({
        where: { runId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    return {
      ok: true,
      run: {
        id: run.id,
        status: run.status,
        summary: run.summary,
        error: run.error,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        createdAt: run.createdAt,
        updatedAt: run.updatedAt,
        caseCount: run.caseCount,
        models: parseStringList(run.modelsJson),
        request: this.tryParse(run.requestJson),
      },
      cases: cases.map((c) => ({
        id: c.id,
        runId: c.runId,
        ingestId: c.ingestId,
        signalId: c.signalId,
        chatId: c.chatId,
        messageId: c.messageId,
        title: c.title,
        status: c.status,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        trace: this.tryParse(c.traceJson),
      })),
      modelResults: modelResults.map((m) => ({
        ...m,
      })),
      stepResults: stepResults.map((s) => ({
        ...s,
        issues: this.tryParseArray(s.issuesJson),
        evidence: this.tryParseArray(s.evidenceJson),
        missingContext: this.tryParseArray(s.missingContextJson),
        recommendedFixes: this.tryParseArray(s.recommendedFixesJson),
        payload: this.tryParse(s.payloadJson),
      })),
      logs: logs.map((l) => ({
        ...l,
        payload: this.tryParse(l.payload),
      })),
    };
  }

  private async processCase(runId: string, models: string[], trace: DiagnosticCaseTrace) {
    const diagnosticCase = await this.prisma.diagnosticCase.create({
      data: {
        runId,
        ingestId: trace.ingest.id,
        signalId:
          trace.signal && typeof trace.signal === 'object'
            ? String((trace.signal as { id?: string }).id ?? '').trim() || null
            : null,
        chatId: trace.ingest.chatId,
        messageId: trace.ingest.messageId,
        title: `${trace.ingest.chatId}:${trace.ingest.messageId}`,
        status: 'pending',
        traceJson: toJsonString(trace),
      },
    });

    await this.appendCaseLog(runId, diagnosticCase.id, 'info', 'diagnostics', 'case started', {
      ingestId: trace.ingest.id,
      messageId: trace.ingest.messageId,
      classification: trace.ingest.classification,
      status: trace.ingest.status,
    });

    let caseFailed = false;
    for (const model of models) {
      try {
        const audited = await this.ai.auditCaseWithModel(model, trace);
        const modelResult = await this.prisma.diagnosticModelResult.create({
          data: {
            runId,
            caseId: diagnosticCase.id,
            model,
            status: audited.status,
            summary: audited.finalComment,
            rawResponse: audited.rawResponse,
            inputTokens: audited.usage?.inputTokens ?? null,
            outputTokens: audited.usage?.outputTokens ?? null,
            totalTokens: audited.usage?.totalTokens ?? null,
          },
        });
        await this.persistSteps(runId, diagnosticCase.id, modelResult.id, audited.steps);
        await this.appendCaseLog(runId, diagnosticCase.id, 'info', 'openrouter', 'model audit completed', {
          model,
          status: audited.status,
          requestPreview: audited.requestPreview,
          usage: audited.usage,
        }, modelResult.id);
      } catch (e) {
        caseFailed = true;
        const error = e instanceof Error ? e.message : String(e);
        await this.appendCaseLog(runId, diagnosticCase.id, 'error', 'openrouter', 'model audit failed', {
          model,
          error,
        });
      }
    }

    const verifierStep = this.metricsVerifier.verify(trace);
    await this.persistSteps(runId, diagnosticCase.id, null, [verifierStep]);
    if (verifierStep.status !== 'ok') {
      await this.appendCaseLog(runId, diagnosticCase.id, 'warn', 'diagnostics', 'metrics verifier warning', {
        issues: verifierStep.issues,
      });
    }

    await this.prisma.diagnosticCase.update({
      where: { id: diagnosticCase.id },
      data: {
        status: caseFailed ? 'failed' : 'completed',
      },
    });
  }

  private async persistSteps(
    runId: string,
    caseId: string,
    modelResultId: string | null,
    steps: DiagnosticStepAudit[],
  ) {
    for (const step of steps) {
      await this.prisma.diagnosticStepResult.create({
        data: {
          runId,
          caseId,
          modelResultId: modelResultId ?? null,
          stepKey: step.stepKey,
          status: step.status,
          comment: step.comment,
          issuesJson: JSON.stringify(step.issues),
          evidenceJson: JSON.stringify(step.evidence),
          missingContextJson: JSON.stringify(step.missingContext),
          recommendedFixesJson: JSON.stringify(step.recommendedFixes),
          payloadJson: null,
        },
      });
    }
  }

  private async appendRunLog(
    runId: string,
    level: string,
    category: string,
    message: string,
    payload?: unknown,
  ) {
    await this.prisma.diagnosticLog.create({
      data: {
        runId,
        level,
        category,
        message,
        payload: payload === undefined ? null : toJsonString(payload),
      },
    });
  }

  private async appendCaseLog(
    runId: string,
    caseId: string,
    level: string,
    category: string,
    message: string,
    payload?: unknown,
    modelResultId?: string,
  ) {
    await this.prisma.diagnosticLog.create({
      data: {
        runId,
        caseId,
        modelResultId: modelResultId ?? null,
        level,
        category,
        message,
        payload: payload === undefined ? null : toJsonString(payload),
      },
    });
  }

  private async buildRunSummary(runId: string): Promise<string> {
    const [cases, modelResults, warnings, errors] = await Promise.all([
      this.prisma.diagnosticCase.count({ where: { runId } }),
      this.prisma.diagnosticModelResult.count({ where: { runId } }),
      this.prisma.diagnosticStepResult.count({
        where: { runId, status: 'warning' },
      }),
      this.prisma.diagnosticStepResult.count({
        where: { runId, status: 'error' },
      }),
    ]);
    return `Кейсов: ${cases}, модельных отчётов: ${modelResults}, warning: ${warnings}, error: ${errors}`;
  }

  private async resolveDiagnosticModels(): Promise<string[]> {
    const raw = await this.settings.get(DIAGNOSTIC_MODELS_KEY);
    const parsed = parseStringList(raw);
    if (parsed.length > 0) {
      return parsed;
    }
    const fallback = [
      (await this.settings.get('OPENROUTER_MODEL_TEXT'))?.trim(),
      (await this.settings.get('OPENROUTER_MODEL_DEFAULT'))?.trim(),
      ...DEFAULT_DIAGNOSTIC_MODELS,
    ].filter((v): v is string => Boolean(v));
    return Array.from(new Set(fallback));
  }

  private async resolveBatchSize(override?: number): Promise<number> {
    if (Number.isFinite(override)) {
      return clamp(Math.trunc(override as number), 1, 50);
    }
    const raw = await this.settings.get(DIAGNOSTIC_BATCH_SIZE_KEY);
    return clamp(toFiniteInt(raw, DEFAULT_DIAGNOSTIC_BATCH_SIZE), 1, 50);
  }

  private async resolveMaxLogLines(): Promise<number> {
    const raw = await this.settings.get(DIAGNOSTIC_MAX_LOG_LINES_KEY);
    return clamp(toFiniteInt(raw, DEFAULT_DIAGNOSTIC_MAX_LOG_LINES), 20, 500);
  }

  private tryParse(raw: string | null): unknown {
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }

  private tryParseArray(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed)
        ? parsed.map((v) => String(v ?? '')).filter((v) => v.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  }

  private async executeRun(
    runId: string,
    models: string[],
    batchSize: number,
    maxLogLines: number,
  ) {
    try {
      const traces = await this.traceBuilder.buildLatestIngestTraces({
        limit: batchSize,
        maxLogLines,
      });

      await this.prisma.diagnosticRun.update({
        where: { id: runId },
        data: { caseCount: traces.length },
      });

      for (const trace of traces) {
        await this.processCase(runId, models, trace);
      }

      const runSummary = await this.buildRunSummary(runId);
      await this.prisma.diagnosticRun.update({
        where: { id: runId },
        data: {
          status: 'completed',
          summary: runSummary,
          finishedAt: new Date(),
        },
      });
      await this.appendRunLog(runId, 'info', 'diagnostics', 'run completed', {
        summary: runSummary,
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.prisma.diagnosticRun.update({
        where: { id: runId },
        data: {
          status: 'failed',
          error,
          finishedAt: new Date(),
        },
      });
      await this.appendRunLog(runId, 'error', 'diagnostics', 'run failed', { error });
    }
  }
}
