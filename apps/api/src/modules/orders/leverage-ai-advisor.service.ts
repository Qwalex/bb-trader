import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OpenRouter } from '@openrouter/sdk';

import { SettingsService } from '../settings/settings.service';

import type {
  LeverageCalculatorAiAdviceRequest,
  LeverageCalculatorAiAdviceResponse,
} from './leverage-ai-advisor.types';

const OPENROUTER_SITE_URL = 'https://signals-bot.local';
const OPENROUTER_APP_TITLE = 'SignalsBot Leverage Advisor';

const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    points: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 10,
    },
    disclaimer: { type: 'string' },
  },
  required: ['summary', 'points', 'disclaimer'],
  additionalProperties: false,
} as const;

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toFinite(raw: unknown, fallback: number): number {
  const n = typeof raw === 'number' ? raw : Number(String(raw ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function strList(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v ?? '').trim().slice(0, maxLen))
    .filter((v) => v.length > 0)
    .slice(0, maxItems);
}

@Injectable()
export class LeverageAiAdvisorService {
  private readonly logger = new Logger(LeverageAiAdvisorService.name);

  constructor(private readonly settings: SettingsService) {}

  async generateAdvice(raw: unknown): Promise<LeverageCalculatorAiAdviceResponse> {
    const body = this.parseAndSanitizeBody(raw);

    const apiKey = (await this.settings.get('OPENROUTER_API_KEY'))?.trim();
    if (!apiKey) {
      return { ok: false, error: 'OPENROUTER_API_KEY не задан в настройках.' };
    }

    let model = (await this.settings.get('OPENROUTER_MODEL_AI_ADVISOR'))?.trim();
    if (!model) {
      model =
        (await this.settings.get('OPENROUTER_MODEL_TEXT'))?.trim() ||
        (await this.settings.get('OPENROUTER_MODEL_DEFAULT'))?.trim() ||
        '';
    }
    if (!model) {
      return {
        ok: false,
        error:
          'Не задана модель для ИИ (OPENROUTER_MODEL_AI_ADVISOR или OPENROUTER_MODEL_TEXT / OPENROUTER_MODEL_DEFAULT).',
      };
    }

    const client = new OpenRouter({
      apiKey,
      httpReferer: OPENROUTER_SITE_URL,
      xTitle: OPENROUTER_APP_TITLE,
      timeoutMs: 180_000,
    });

    const systemPrompt = [
      'Ты финансовый аналитик по персональному сценарию кредита под торговый капитал (USDT).',
      'Пользователь передал JSON со снимком упрощённой модели: r = PnL/день ÷ equity, дискретные месяцы по 30 дней, капитал с займом vs только собственный equity, опционально досрочное погашение.',
      'Дай практические рекомендации на русском: стоит ли опираться на займ, когда досрочное может иметь смысл, на что смотреть в договоре с банком.',
      'Не выдумывай цифры вне JSON; не обещай доходность; не подменяй юридический совет.',
      'Если в данных мало оснований (нет equity, нет r, много предупреждений) — честно скажи, что выводы ограничены.',
      'Верни ТОЛЬКО JSON по схеме: summary (2–5 предложений), points (короткие буллеты), disclaimer (одно предложение о том, что это не индивидуальная консультация).',
    ].join('\n');

    const userPayload = {
      snapshot: body,
      generatedAt: new Date().toISOString(),
    };

    try {
      const res = await client.chat.send({
        httpReferer: OPENROUTER_SITE_URL,
        xTitle: OPENROUTER_APP_TITLE,
        chatGenerationParams: {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: JSON.stringify(userPayload) },
          ] as never,
          responseFormat: {
            type: 'json_schema',
            jsonSchema: {
              name: 'leverage_calculator_ai_advice',
              strict: true,
              schema: RESPONSE_JSON_SCHEMA,
            },
          },
          stream: false,
        },
      });

      const rawContent = res.choices?.[0]?.message?.content;
      if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
        return { ok: false, error: 'Пустой ответ от модели.' };
      }
      const parsed = parseJsonObject(rawContent);
      if (!parsed) {
        return { ok: false, error: 'Модель вернула невалидный JSON.' };
      }
      const summary = String(parsed.summary ?? '').trim();
      const points = Array.isArray(parsed.points)
        ? parsed.points
            .map((p) => String(p ?? '').trim())
            .filter((p) => p.length > 0)
        : [];
      const disclaimer = String(parsed.disclaimer ?? '').trim();
      if (!summary || points.length === 0) {
        return { ok: false, error: 'Модель вернула неполный ответ.' };
      }
      return {
        ok: true,
        summary,
        points: points.slice(0, 10),
        disclaimer: disclaimer || 'Это не индивидуальная инвестиционная рекомендация.',
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`leverage AI: ${msg}`);
      return { ok: false, error: `Запрос к ИИ не удался: ${msg}` };
    }
  }

  private parseAndSanitizeBody(raw: unknown): LeverageCalculatorAiAdviceRequest {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('Ожидался JSON-объект в теле запроса.');
    }
    const o = raw as Record<string, unknown>;

    const mode = o.mode === 'realized' ? 'realized' : 'expected';
    const horizonMonthsAfterLoan = clamp(toFinite(o.horizonMonthsAfterLoan, 0), 0, 600);

    const loanRaw = o.loan && typeof o.loan === 'object' && !Array.isArray(o.loan) ? o.loan : {};
    const lr = loanRaw as Record<string, unknown>;
    const loan = {
      principalUsd: clamp(toFinite(lr.principalUsd, 0), 0, 1e9),
      monthlyPaymentUsd: clamp(toFinite(lr.monthlyPaymentUsd, 0), 0, 1e9),
      termMonths: clamp(Math.trunc(toFinite(lr.termMonths, 0)), 0, 1200),
    };

    const epRaw = o.earlyPayoff && typeof o.earlyPayoff === 'object' && !Array.isArray(o.earlyPayoff) ? o.earlyPayoff : {};
    const er = epRaw as Record<string, unknown>;
    const earlyPayoff = {
      enabled: er.enabled === true,
      closeAfterMonth: clamp(Math.trunc(toFinite(er.closeAfterMonth, 0)), 0, 1200),
      closeoutUsd: clamp(toFinite(er.closeoutUsd, 0), 0, 1e9),
    };

    const payRaw =
      o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload) ? o.payload : {};
    const pr = payRaw as Record<string, unknown>;
    const eq = pr.equityUsd;
    const payload = {
      equityUsd:
        eq == null || eq === ''
          ? null
          : clamp(toFinite(eq, 0), 0, 1e12),
      expectedPnlPerDayUsd:
        pr.expectedPnlPerDayUsd == null || pr.expectedPnlPerDayUsd === ''
          ? null
          : toFinite(pr.expectedPnlPerDayUsd, 0),
      realizedPnlPerDayUsd:
        pr.realizedPnlPerDayUsd == null || pr.realizedPnlPerDayUsd === ''
          ? null
          : toFinite(pr.realizedPnlPerDayUsd, 0),
      statsPeriodDaysMax:
        pr.statsPeriodDaysMax == null || pr.statsPeriodDaysMax === ''
          ? null
          : clamp(Math.trunc(toFinite(pr.statsPeriodDaysMax, 0)), 0, 100_000),
      cabinetCount: clamp(Math.trunc(toFinite(pr.cabinetCount, 0)), 0, 50_000),
    };

    const outlookSnapshot =
      o.outlookSnapshot && typeof o.outlookSnapshot === 'object' && !Array.isArray(o.outlookSnapshot)
        ? (o.outlookSnapshot as Record<string, unknown>)
        : {};

    const verdictRaw = o.verdict;
    let verdict: LeverageCalculatorAiAdviceRequest['verdict'] = null;
    if (verdictRaw && typeof verdictRaw === 'object' && !Array.isArray(verdictRaw)) {
      const vr = verdictRaw as Record<string, unknown>;
      const tone = String(vr.tone ?? '').trim().slice(0, 16);
      const lead = String(vr.lead ?? '').trim().slice(0, 800);
      if (tone && lead) {
        verdict = { tone, lead };
      }
    }

    const hints = strList(o.hints, 12, 500);
    const warnings = strList(o.warnings, 12, 500);
    const userComment = String(o.userComment ?? '')
      .trim()
      .slice(0, 800);

    return {
      mode,
      horizonMonthsAfterLoan,
      loan,
      earlyPayoff,
      payload,
      outlookSnapshot,
      verdict,
      hints,
      warnings,
      ...(userComment.length > 0 ? { userComment } : {}),
    };
  }
}
