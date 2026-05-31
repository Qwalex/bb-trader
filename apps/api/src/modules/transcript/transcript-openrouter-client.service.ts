import { Injectable, Logger } from '@nestjs/common';
import { OpenRouter } from '@openrouter/sdk';

import { sanitizeForOpenRouterLog } from '../app-log/log-sanitize';
import { AppLogService } from '../app-log/app-log.service';
import type { ContentKind } from '@repo/shared';
import {
  OPENROUTER_APP_TITLE,
  OPENROUTER_MAX_RETRIES,
  OPENROUTER_RETRY_DELAY_MS,
  OPENROUTER_SITE_URL,
  OPENROUTER_URL,
} from './transcript.constants';
import type { OpenRouterLogContext } from './transcript.types';
import {
  CLASSIFIER_RESPONSE_JSON_SCHEMA,
  CONTENT_REWRITE_JSON_SCHEMA,
  FILTER_PATTERN_GENERATION_JSON_SCHEMA,
  TRANSCRIPT_RESPONSE_JSON_SCHEMA,
} from './transcript-model-json-schemas';
import { formatOpenRouterError } from './transcript-openrouter-parse.util';
import { TranscriptOpenRouterBillingService } from './transcript-openrouter-billing.service';

@Injectable()
export class TranscriptOpenRouterClientService {
  private readonly logger = new Logger(TranscriptOpenRouterClientService.name);

  constructor(
    private readonly appLog: AppLogService,
    private readonly billing: TranscriptOpenRouterBillingService,
  ) {}

  async callOpenRouter(
    apiKey: string,
    model: string,
    messages: { role: string; content: unknown }[],
    ctx: {
      operation: string;
      kind?: ContentKind;
      fallbackModels?: string[];
      logContext?: OpenRouterLogContext;
    },
  ): Promise<unknown> {
    const client = new OpenRouter({
      apiKey,
      httpReferer: OPENROUTER_SITE_URL,
      xTitle: OPENROUTER_APP_TITLE,
      timeoutMs: 180_000,
    });

    const schemaName =
      ctx.operation === 'classifyTradingMessage'
        ? 'transcript_classifier_result'
        : ctx.operation === 'generateFilterPatterns'
          ? 'transcript_filter_pattern_generation_result'
          : ctx.operation === 'rewriteContentPost'
            ? 'transcript_content_rewrite_result'
            : 'transcript_signal_result';
    const schema =
      ctx.operation === 'classifyTradingMessage'
        ? CLASSIFIER_RESPONSE_JSON_SCHEMA
        : ctx.operation === 'generateFilterPatterns'
          ? FILTER_PATTERN_GENERATION_JSON_SCHEMA
          : ctx.operation === 'rewriteContentPost'
            ? CONTENT_REWRITE_JSON_SCHEMA
            : TRANSCRIPT_RESPONSE_JSON_SCHEMA;
    const responseFormat = {
      type: 'json_schema' as const,
      jsonSchema: {
        name: schemaName,
        strict: true,
        schema,
      },
    };

    const requestBody = {
      model,
      models:
        ctx.fallbackModels && ctx.fallbackModels.length > 0
          ? [model, ...ctx.fallbackModels]
          : undefined,
      messages: sanitizeForOpenRouterLog(messages) as unknown[],
      responseFormat,
    };
    await this.appLog.append('info', 'openrouter', `→ ${ctx.operation}`, {
      url: OPENROUTER_URL,
      method: 'POST',
      operation: ctx.operation,
      contentKind: ctx.kind,
      /** Тело запроса (как уходит к OpenRouter, без секрета — ключ только в заголовке Authorization, не логируем) */
      requestBody,
      logContext: ctx.logContext,
    });

    try {
      let res: unknown;
      let lastError: unknown;
      for (let attempt = 1; attempt <= OPENROUTER_MAX_RETRIES; attempt += 1) {
        try {
          res = await client.chat.send({
            httpReferer: OPENROUTER_SITE_URL,
            xTitle: OPENROUTER_APP_TITLE,
            chatGenerationParams: {
              model,
              models:
                ctx.fallbackModels && ctx.fallbackModels.length > 0
                  ? [model, ...ctx.fallbackModels]
                  : undefined,
              messages: messages as never,
              responseFormat,
              stream: false,
            },
          });
          break;
        } catch (attemptError) {
          lastError = attemptError;
          const errText = formatOpenRouterError(attemptError);
          this.logger.warn(
            `OpenRouter ${ctx.operation} attempt ${attempt}/${OPENROUTER_MAX_RETRIES} failed: ${errText}`,
          );
          if (attempt < OPENROUTER_MAX_RETRIES) {
            await new Promise((resolve) =>
              setTimeout(resolve, OPENROUTER_RETRY_DELAY_MS),
            );
          }
        }
      }
      if (res == null) {
        throw (
          lastError ??
          new Error(
            `OpenRouter request failed after ${OPENROUTER_MAX_RETRIES} attempts`,
          )
        );
      }
      const typedRes = res as {
        id?: string;
        model?: string;
        usage?: unknown;
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const usageRecord =
        typedRes.usage && typeof typedRes.usage === 'object' && !Array.isArray(typedRes.usage)
          ? (typedRes.usage as Record<string, unknown>)
          : undefined;
      const generationId = String(typedRes.id ?? '').trim();
      if (generationId) {
        await this.billing.upsertGenerationCostEntry({
          generationId,
          operation: ctx.operation,
          logContext: ctx.logContext,
          status: 'pending',
          attemptsDelta: 0,
          nextRetryAt: new Date(),
        });
      }
      const resolvedCostUsd = null;

      const rawContent = typedRes.choices?.[0]?.message?.content;
      const responseContent =
        typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);

      await this.appLog.append('info', 'openrouter', `← ${ctx.operation}`, {
        operation: ctx.operation,
        httpStatus: 200,
        /** Полный текст ответа ассистента (без обрезки) */
        assistantContent: responseContent,
        /** Полный объект ответа OpenRouter после sanitize (без секретов) */
        openrouterResponse: sanitizeForOpenRouterLog(res),
        /** Метаданные ответа OpenRouter (без дублирования полного текста) */
        responseMeta: {
          id: typedRes.id,
          model: typedRes.model,
          usage: usageRecord,
          costUsd: resolvedCostUsd ?? undefined,
          costSource: undefined,
          generationCostUsd: undefined,
          choicesCount: typedRes.choices?.length ?? 0,
        },
        logContext: ctx.logContext,
      });

      if (rawContent == null) {
        throw new Error('Empty response from OpenRouter');
      }
      return rawContent;
    } catch (e) {
      const errObj = e as {
        status?: number;
        statusCode?: number;
        error?: unknown;
        cause?: unknown;
        body?: string;
      };
      await this.appLog.append(
        'error',
        'openrouter',
        `✗ ${ctx.operation} failed`,
        {
          operation: ctx.operation,
          error: formatOpenRouterError(e),
          retries: OPENROUTER_MAX_RETRIES,
          status: errObj.status ?? errObj.statusCode,
          responseBody: sanitizeForOpenRouterLog(
            errObj.error ?? errObj.cause ?? errObj.body,
          ),
        },
      );
      throw e;
    }
  }
}
