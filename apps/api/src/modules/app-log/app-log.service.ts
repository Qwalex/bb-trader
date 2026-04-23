import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../prisma/prisma.service';
import { CabinetContextService } from '../cabinet/cabinet-context.service';
import { SettingsService } from '../settings/settings.service';

import { pruneOldLogs, stringifyPayload } from './log-sanitize';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogCategory =
  | 'openrouter'
  | 'telegram'
  | 'vk'
  | 'bybit'
  | 'orders'
  | 'system';

const MAX_ROWS = 100_000;
const NOISE_MESSAGES = [
  'poll: stale signal kept because exchange exposure still exists',
  'poll: reconcile stale pass started',
  'Userbot: duplicate ingest skipped',
] as const;

/** Частые ожидаемые warn по TP — не пишем в БД по умолчанию; при переполнении вытесняются раньше прочих warn. */
const NOISE_WARN_MESSAGES = [
  'placeTpSplit: уровень TP пропущен — в БД уже учтены ордера на этой цене (проверьте, что статусы совпадают с биржей)',
  'placeTpSplit: число TP уменьшено из-за minQty лота',
] as const;

/** Не пишем в БД (страница /logs): высокочастотный отладочный шум. */
const SKIP_DB_APPEND_MESSAGES = new Set<string>([
  ...NOISE_MESSAGES,
  ...NOISE_WARN_MESSAGES,
  'poll: stale reconcile skipped because pair is suspended',
  'poll: stale reconcile postponed until clean state repeats',
  'poll: no stale signals found to reconcile for clean exchange side',
  'poll: no live position for signal direction before close candidate evaluation',
  'immediate stale blocker cleanup skipped because exchange exposure exists',
  'stale reconcile suspended',
  'stale reconcile resumed',
  'stale reconcile suspension decremented',
  'Userbot: pair/direction transition started',
  'Userbot: pair/direction transition finished',
  'Userbot: pair/direction transition decremented',
  'Userbot: close cooldown set',
  'Reentry: resolved root source message',
  'Close: resolved root source message',
  'Userbot: released signal hash',
  'Userbot: processing started',
  'Userbot: parse started',
]);

function shouldSkipDbAppend(
  level: LogLevel,
  message: string,
  opts: { logNoisyEvents: boolean },
): boolean {
  const skipAllDebug =
    process.env.APPLOG_DB_SKIP_DEBUG === '1' ||
    String(process.env.APPLOG_DB_SKIP_DEBUG ?? '')
      .toLowerCase()
      .trim() === 'true';
  if (skipAllDebug && level === 'debug') {
    return true;
  }
  if (opts.logNoisyEvents) {
    return false;
  }
  return SKIP_DB_APPEND_MESSAGES.has(message);
}

function parseLogNoisySetting(raw: string | undefined): boolean {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

/** Писать ли в AppLog; по умолчанию true (ключ не задан / пусто / мусор). */
function parseAppLogEnabled(raw: string | undefined): boolean {
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return true;
  }
  const s = String(raw).trim().toLowerCase();
  if (
    s === 'false' ||
    s === '0' ||
    s === 'no' ||
    s === 'off' ||
    s === 'disabled'
  ) {
    return false;
  }
  return true;
}

@Injectable()
export class AppLogService {
  private static readonly LOG_NOISY_POLICY_TTL_MS = 10_000;

  private readonly logger = new Logger(AppLogService.name);
  private dbFullMuteUntilTs = 0;
  private dbFullLastErrorTs = 0;
  private logNoisyPolicyCache: { expiresAt: number; value: boolean } | null =
    null;
  private logEnabledPolicyCache: { expiresAt: number; value: boolean } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly settings: SettingsService,
  ) {}

  private async resolveLogNoisyEventsEnabled(): Promise<boolean> {
    const now = Date.now();
    if (
      this.logNoisyPolicyCache &&
      now < this.logNoisyPolicyCache.expiresAt
    ) {
      return this.logNoisyPolicyCache.value;
    }
    let raw: string | undefined;
    try {
      raw = await this.settings.get('APPLOG_LOG_NOISY_EVENTS');
    } catch {
      raw = undefined;
    }
    const value = parseLogNoisySetting(raw);
    this.logNoisyPolicyCache = {
      value,
      expiresAt: now + AppLogService.LOG_NOISY_POLICY_TTL_MS,
    };
    return value;
  }

  private async resolveAppLogWritesEnabled(): Promise<boolean> {
    const now = Date.now();
    if (
      this.logEnabledPolicyCache &&
      now < this.logEnabledPolicyCache.expiresAt
    ) {
      return this.logEnabledPolicyCache.value;
    }
    let raw: string | undefined;
    try {
      raw = await this.settings.get('APPLOG_ENABLED');
    } catch {
      raw = undefined;
    }
    const value = parseAppLogEnabled(raw);
    this.logEnabledPolicyCache = {
      value,
      expiresAt: now + AppLogService.LOG_NOISY_POLICY_TTL_MS,
    };
    return value;
  }

  private isDbFullError(e: unknown): boolean {
    const msg = String(e ?? '').toLowerCase();
    return (
      msg.includes('database or disk is full') ||
      msg.includes('no space left on device') ||
      msg.includes('could not extend file') ||
      (msg.includes('sqliteerror') && msg.includes('extended_code: 13'))
    );
  }

  private shouldMuteDbWrites(): boolean {
    return Date.now() < this.dbFullMuteUntilTs;
  }

  private activateDbFullMute(errText: string): void {
    const now = Date.now();
    // При переполнении диска/БД глушим запись логов на 5 минут,
    // чтобы не усиливать проблему лавиной повторных write.
    this.dbFullMuteUntilTs = now + 5 * 60_000;
    if (now - this.dbFullLastErrorTs > 60_000) {
      this.dbFullLastErrorTs = now;
      this.logger.error(
        `AppLog write muted for 5m (disk/DB full): ${errText}`,
      );
    }
  }

  async append(
    level: LogLevel,
    category: LogCategory,
    message: string,
    payload?: unknown,
  ): Promise<void> {
    if (!(await this.resolveAppLogWritesEnabled())) {
      return;
    }
    const logNoisyEvents = await this.resolveLogNoisyEventsEnabled();
    if (shouldSkipDbAppend(level, message, { logNoisyEvents })) {
      return;
    }
    if (this.shouldMuteDbWrites()) {
      return;
    }
    try {
      const payloadStr =
        payload === undefined ? null : stringifyPayload(payload);
      await this.prisma.appLog.create({
        data: {
          cabinetId: this.cabinetContext.getCabinetId() ?? undefined,
          level,
          category,
          message,
          payload: payloadStr,
        },
      });
      void pruneOldLogs(
        this.prisma,
        MAX_ROWS,
        NOISE_MESSAGES,
        NOISE_WARN_MESSAGES,
      ).catch((e) => this.logger.warn(`pruneOldLogs: ${String(e)}`));
    } catch (e) {
      const errText = String(e);
      if (this.isDbFullError(e)) {
        this.activateDbFullMute(errText);
        return;
      }
      this.logger.error(`append log failed: ${errText}`);
    }
  }

  async list(options: {
    limit?: number;
    category?: string;
  }): Promise<
    {
      id: string;
      level: string;
      category: string;
      message: string;
      payload: string | null;
      createdAt: Date;
    }[]
  > {
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000);
    const cabinetId = this.cabinetContext.getCabinetId();
    const where =
      options.category && options.category !== 'all'
        ? { category: options.category, cabinetId: cabinetId ?? null }
        : { cabinetId: cabinetId ?? null };
    return this.prisma.appLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async deleteOldNoiseLogs(): Promise<void> {
    if (!(await this.resolveAppLogWritesEnabled())) {
      return;
    }
    if (this.shouldMuteDbWrites()) {
      return;
    }
    const olderThan = new Date(Date.now() - 30 * 60 * 1000);
    try {
      const result = await this.prisma.appLog.deleteMany({
        where: {
          message: { in: [...NOISE_MESSAGES, ...NOISE_WARN_MESSAGES] },
          createdAt: { lt: olderThan },
        },
      });
      if (result.count > 0) {
        this.logger.log(`deleted old noise logs: ${result.count}`);
      }
    } catch (e) {
      if (this.isDbFullError(e)) {
        this.activateDbFullMute(String(e));
        return;
      }
      this.logger.warn(`deleteOldNoiseLogs failed: ${String(e)}`);
    }
  }

  @Cron('0 0 0 */3 * *')
  async deleteOldRegularLogs(): Promise<void> {
    if (!(await this.resolveAppLogWritesEnabled())) {
      return;
    }
    if (this.shouldMuteDbWrites()) {
      return;
    }
    const olderThan = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    try {
      const result = await this.prisma.appLog.deleteMany({
        where: {
          message: { notIn: [...NOISE_MESSAGES] },
          createdAt: { lt: olderThan },
        },
      });
      if (result.count > 0) {
        this.logger.log(`deleted old regular logs: ${result.count}`);
      }
    } catch (e) {
      if (this.isDbFullError(e)) {
        this.activateDbFullMute(String(e));
        return;
      }
      this.logger.warn(`deleteOldRegularLogs failed: ${String(e)}`);
    }
  }
}
