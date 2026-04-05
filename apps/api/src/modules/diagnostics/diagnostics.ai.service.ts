import { Injectable } from '@nestjs/common';
import { OpenRouter } from '@openrouter/sdk';

import { SettingsService } from '../settings/settings.service';
import {
  DIAGNOSTIC_AI_STEP_KEYS,
} from './diagnostics.constants';
import type {
  DiagnosticCaseTrace,
  DiagnosticModelAuditResult,
  DiagnosticStepAudit,
} from './diagnostics.types';
import { arrStrings, normalizeStatus, parseJsonObject } from './diagnostics.utils';

const OPENROUTER_SITE_URL = 'https://signals-bot.local';
const OPENROUTER_APP_TITLE = 'SignalsBot Diagnostics';

const DIAGNOSTICS_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    overallStatus: { type: 'string', enum: ['ok', 'warning', 'error', 'unknown'] },
    finalComment: { type: 'string' },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          stepKey: {
            type: 'string',
            enum: DIAGNOSTIC_AI_STEP_KEYS,
          },
          status: { type: 'string', enum: ['ok', 'warning', 'error', 'unknown'] },
          comment: { type: 'string' },
          issues: { type: 'array', items: { type: 'string' } },
          evidence: { type: 'array', items: { type: 'string' } },
          missingContext: { type: 'array', items: { type: 'string' } },
          recommendedFixes: { type: 'array', items: { type: 'string' } },
        },
        required: [
          'stepKey',
          'status',
          'comment',
          'issues',
          'evidence',
          'missingContext',
          'recommendedFixes',
        ],
        additionalProperties: false,
      },
    },
  },
  required: ['overallStatus', 'finalComment', 'steps'],
  additionalProperties: false,
} as const;

@Injectable()
export class DiagnosticsAiService {
  private openRouterClientCache: { key: string; client: OpenRouter } | null = null;

  constructor(private readonly settings: SettingsService) {}

  private getOpenRouterClient(apiKey: string): OpenRouter {
    if (this.openRouterClientCache?.key === apiKey) {
      return this.openRouterClientCache.client;
    }
    const client = new OpenRouter({
      apiKey,
      httpReferer: OPENROUTER_SITE_URL,
      xTitle: OPENROUTER_APP_TITLE,
      timeoutMs: 180_000,
    });
    this.openRouterClientCache = { key: apiKey, client };
    return client;
  }

  async auditCaseWithModel(
    model: string,
    trace: DiagnosticCaseTrace,
    workspaceId: string,
  ): Promise<DiagnosticModelAuditResult> {
    const apiKey = (await this.settings.get('OPENROUTER_API_KEY', workspaceId.trim()))?.trim();
    if (!apiKey) {
      throw new Error('OPENROUTER_API_KEY не задан');
    }

    const compactTrace = this.compactTrace(trace);
    const requestPreview = JSON.stringify(compactTrace).slice(0, 3000);

    const client = this.getOpenRouterClient(apiKey);

    const prompt = [
      'Ты — строгий диагност пайплайна торговых сигналов.',
      'Проанализируй предоставленный trace целиком.',
      'Оцени каждый шаг и укажи проблемы, доказательства и рекомендации.',
      'Будь максимально конкретным, не придумывай факты, отмечай missingContext если данных нет.',
      'Все текстовые поля ответа должны быть только на русском языке.',
      'Пиши на русском: finalComment, comment, issues, evidence, missingContext, recommendedFixes.',
      'Не используй английский язык в пояснениях, кроме технических идентификаторов, статусов, названий моделей, ключей и исходных символов из trace.',
      `Обязательные шаги: ${DIAGNOSTIC_AI_STEP_KEYS.join(', ')}`,
      'Верни ТОЛЬКО JSON.',
    ].join('\n');

    const messages: { role: 'system' | 'user'; content: string }[] = [
      {
        role: 'system',
        content: prompt,
      },
      {
        role: 'user',
        content: JSON.stringify({
          caseKey: `${trace.ingest.chatId}:${trace.ingest.messageId}`,
          locale: 'ru',
          trace: compactTrace,
        }),
      },
    ];

    const res = await client.chat.send({
      httpReferer: OPENROUTER_SITE_URL,
      xTitle: OPENROUTER_APP_TITLE,
      chatGenerationParams: {
        model,
        messages: messages as never,
        responseFormat: {
          type: 'json_schema',
          jsonSchema: {
            name: 'diagnostics_step_audit',
            strict: true,
            schema: DIAGNOSTICS_RESPONSE_JSON_SCHEMA,
          },
        },
        stream: false,
      },
    });

    const rawContent = res.choices?.[0]?.message?.content;
    if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
      throw new Error('Пустой ответ от OpenRouter diagnostics');
    }

    const parsed = parseJsonObject(rawContent);
    if (!parsed) {
      throw new Error('Диагностическая модель вернула невалидный JSON');
    }

    const stepByKey = new Map<string, DiagnosticStepAudit>();
    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    for (const stepRaw of rawSteps) {
      const obj =
        stepRaw && typeof stepRaw === 'object' && !Array.isArray(stepRaw)
          ? (stepRaw as Record<string, unknown>)
          : null;
      if (!obj) continue;
      const key = String(obj.stepKey ?? '');
      if (!DIAGNOSTIC_AI_STEP_KEYS.includes(key as never)) continue;
      stepByKey.set(key, {
        stepKey: key as DiagnosticStepAudit['stepKey'],
        status: normalizeStatus(obj.status),
        comment: String(obj.comment ?? '').trim(),
        issues: arrStrings(obj.issues),
        evidence: arrStrings(obj.evidence),
        missingContext: arrStrings(obj.missingContext),
        recommendedFixes: arrStrings(obj.recommendedFixes),
      });
    }

    const normalizedSteps: DiagnosticStepAudit[] = DIAGNOSTIC_AI_STEP_KEYS.map((stepKey) => {
      const got = stepByKey.get(stepKey);
      if (got) return got;
      return {
        stepKey,
        status: 'unknown',
        comment: 'Модель не вернула оценку для шага.',
        issues: [],
        evidence: [],
        missingContext: ['Нет ответа по шагу от модели'],
        recommendedFixes: [],
      };
    });

    return {
      status: normalizeStatus(parsed.overallStatus),
      finalComment: String(parsed.finalComment ?? '').trim() || 'Комментарий не предоставлен.',
      steps: normalizedSteps,
      rawResponse: rawContent,
      usage: {
        inputTokens: Number(res.usage?.promptTokens ?? 0) || undefined,
        outputTokens: Number(res.usage?.completionTokens ?? 0) || undefined,
        totalTokens: Number(res.usage?.totalTokens ?? 0) || undefined,
      },
      requestPreview,
    };
  }

  private compactTrace(trace: DiagnosticCaseTrace): Record<string, unknown> {
    const trimText = (v: string | null, max = 3500) => {
      if (v == null) return null;
      if (v.length <= max) return v;
      return `${v.slice(0, max)}... [truncated ${v.length - max} chars]`;
    };

    return {
      ingest: {
        ...trace.ingest,
        text: trimText(trace.ingest.text, 4500),
        aiRequest: trimText(trace.ingest.aiRequest, 4000),
        aiResponse: trimText(trace.ingest.aiResponse, 4000),
      },
      signal: trace.signal,
      logs: trace.logs.slice(0, 80),
      settingsSnapshot: trace.settingsSnapshot,
      filterPatterns: trace.filterPatterns.slice(0, 60),
      filterExamples: trace.filterExamples.slice(0, 60),
      bybitSnapshot: trace.bybitSnapshot,
      classificationReplay: trace.classificationReplay,
      metricsSnapshot: trace.metricsSnapshot,
    };
  }
}
