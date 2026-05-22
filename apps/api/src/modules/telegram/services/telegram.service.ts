import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { Context, Telegraf } from 'telegraf';

import type { SignalDto } from '@repo/shared';
import { parseTradeSignalNotifyEventFilter } from '@repo/shared';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { CabinetService } from '../../cabinet/cabinet.service';
import { SettingsService } from '../../settings/settings.service';
/** До Bybit/Orders: иначе orders → telegram раньше transcript и TranscriptService в DI = undefined. */
import { TranscriptService } from '../../transcript/transcript.service';
import { BybitService } from '../../bybit/bybit.service';
import { OrdersService } from '../../orders/orders.service';
import {
  formatApiTradeCancelledHtml,
  formatApiTradeLiquidationHtml,
  formatHedgeOppositePlacementAuditHtml,
  formatUserbotResultWithoutEntryHtml,
  formatUserbotSignalFailureMessage,
} from '../utils/telegram-api-notify-html.util';
import { TelegramBotRegistryService } from './telegram-bot-registry.service';
import { TelegramChatMenuService } from './telegram-chat-menu.service';
import { TelegramConversationStateService } from './telegram-conversation-state.service';
import {
  makeExternalRequestKey,
  parseExternalRequestKey,
} from '../utils/telegram-external-request-key.util';
import { escapeTelegramHtml } from '../utils/telegram-html.util';
import {
  confirmKeyboard,
  externalConfirmKeyboard,
  mainMenuKeyboard,
  staleResultCancelKeyboard,
} from '../utils/telegram-keyboards.util';
import {
  formatExternalSignalTable,
  formatSignalTable,
} from '../utils/telegram-signal-message-format.util';
import { TelegramSignalDraftFlowService } from './telegram-signal-draft-flow.service';
import { TelegramSpotFlowService } from './telegram-spot-flow.service';
import { tradeSignalEventTitleRu } from '../utils/telegram-trade-event-titles.util';
import {
  mergeDistinctFiniteNumericIds,
  parseStoredTelegramUserIdAsChatId,
  parseTelegramWhitelistUserIds,
} from '../utils/telegram-whitelist.util';
import {
  makeTelegramBotLaunchCorrelationId,
  makeTelegramBotSyncCorrelationId,
  maskTelegramBotToken,
  TELEGRAM_CABINET_LAUNCH_RETRY_DELAYS_MS,
  type TelegramLaunchTimedOutPhase,
} from '../utils/telegram-bot-launch.util';
import type { ExternalConfirmationResult } from '../types/telegram.types';

@Injectable()
export class TelegramService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private botLaunchRetryTimer: NodeJS.Timeout | null = null;
  private botSyncTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private botSyncInFlight = false;
  /** Не более одного Telegraf launch одновременно (очередь на весь процесс API). */
  private botLaunchSerialGate: Promise<void> = Promise.resolve();
  /** Время завершения последнего deleteWebhook+launch (успех или ошибка) — для `TELEGRAM_BOT_LAUNCH_STAGGER_MS`. */
  private lastCabinetBotLaunchFinishedAt = 0;
  private readonly launchedBotTokensByCabinet = new Map<string, string>();
  /**
   * Один и тот же TELEGRAM_BOT_TOKEN → один процесс long polling.
   * Middleware читает актуальный список кабинетов отсюда, чтобы ACL и AppLog
   * не залипали на первом кабинете при reuse Telegraf.
   */
  private readonly botTokenCabinetRouting = new Map<
    string,
    { cabinetIds: string[] }
  >();
  /** Отложенный sync после неудачного launch (один таймер на кабинет). */
  private readonly cabinetLaunchRetryTimers = new Map<string, NodeJS.Timeout>();
  /** Число подряд неудачных launch для backoff между retry. */
  private readonly cabinetLaunchConsecutiveFailures = new Map<string, number>();
  /** После ошибки в AppLog — при следующем успехе пишем info «recovered». */
  private readonly cabinetLaunchRecoveryPending = new Set<string>();
  /**
   * Long polling: следующий `getUpdates` после батча ждёт завершения всех обработчиков.
   * Разбор сигнала (LLM) уводим в фон и сериализуем по паре (кабинет + Telegram user id),
   * чтобы команды не залипали за минуты и один пользователь в нескольких ботах не блокировал друг друга.
   */
  private readonly telegramHeavyInboundChains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly settings: SettingsService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
    @Inject(forwardRef(() => TranscriptService))
    private readonly transcript: TranscriptService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly prisma: PrismaService,
    private readonly conversationState: TelegramConversationStateService,
    private readonly botRegistry: TelegramBotRegistryService,
    private readonly chatMenu: TelegramChatMenuService,
    private readonly draftFlow: TelegramSignalDraftFlowService,
    @Inject(forwardRef(() => TelegramSpotFlowService))
    private readonly spotFlow: TelegramSpotFlowService,
  ) {}

  /** Дефолт номинала с учётом DEFAULT_ORDER_USD и процента от equity. */
  private async getResolvedDefaultOrderUsd(): Promise<number> {
    const d = await this.bybit.getUnifiedUsdtBalanceDetails();
    return this.settings.getDefaultOrderUsd(d?.totalUsd);
  }

  async onApplicationBootstrap(): Promise<void> {
    // После всех onModuleInit (Prisma $connect, дефолтный кабинет, Settings) — иначе первый sync иногда
    // не видит TELEGRAM_BOT_TOKEN и ложно логирует «боты выключены». Не блокируем HTTP listen: сеть в фоне.
    void this.initializeBots().catch((e) => {
      this.logger.error(`Telegram init failed: ${formatError(e)}`);
    });
  }

  private async initializeBots(): Promise<void> {
    this.shuttingDown = false;
    this.startBotSyncLoop();
    this.startMemoryCleanupLoop();
    const launched = await this.syncBotsWithCabinetTokens();
    if (launched <= 0) {
      this.logger.warn(
        'Telegram: на первом sync нет кабинета с непустым TELEGRAM_BOT_TOKEN (настройки/env). Повтор через интервал sync; если токены заданы — проверьте БД и переменные окружения сервиса API.',
      );
      return;
    }
  }

  private startBotSyncLoop(): void {
    if (this.botSyncTimer) return;
    this.botSyncTimer = setInterval(() => {
      if (this.shuttingDown) {
        return;
      }
      void this.syncBotsWithCabinetTokens().catch((e) => {
        this.logger.warn(`Telegram bot sync failed: ${formatError(e)}`);
      });
    }, 30_000);
  }

  private async syncBotsWithCabinetTokens(): Promise<number> {
    if (this.botSyncInFlight) {
      this.logger.debug('Telegram bot sync skipped: previous sync still running');
      return this.botRegistry.launchedCount;
    }
    this.botSyncInFlight = true;
    try {
      const syncId = makeTelegramBotSyncCorrelationId();
      const cabinets = await this.prisma.cabinet.findMany({
        select: { id: true, name: true },
        orderBy: { createdAt: 'asc' },
      });
      // Эффективный токен как в SettingsService: CabinetSetting → глобальные слои → env.
      const desired = new Map<string, { token: string; name: string }>();
      for (const cabinet of cabinets) {
        const token = await this.cabinetContext.runWithCabinet(cabinet.id, async () =>
          String((await this.settings.get('TELEGRAM_BOT_TOKEN')) ?? '').trim(),
        );
        if (!token) continue;
        desired.set(cabinet.id, { token, name: cabinet.name });
      }

      const seenRoutingTokens = new Set<string>();
      for (const [, cfg] of desired.entries()) {
        seenRoutingTokens.add(cfg.token);
        let routing = this.botTokenCabinetRouting.get(cfg.token);
        if (!routing) {
          routing = { cabinetIds: [] };
          this.botTokenCabinetRouting.set(cfg.token, routing);
        }
        routing.cabinetIds.length = 0;
      }
      for (const [cid, cfg] of desired.entries()) {
        const routing = this.botTokenCabinetRouting.get(cfg.token);
        if (routing) {
          routing.cabinetIds.push(cid);
        }
      }
      for (const key of [...this.botTokenCabinetRouting.keys()]) {
        if (!seenRoutingTokens.has(key)) {
          this.botTokenCabinetRouting.delete(key);
        }
      }

      for (const [cabinetId, existingBot] of this.botRegistry.entries()) {
        const wanted = desired.get(cabinetId);
        const launchedToken = this.launchedBotTokensByCabinet.get(cabinetId);
        if (wanted && launchedToken === wanted.token) {
          continue;
        }
        this.botRegistry.removeCabinetBot(cabinetId);
        this.launchedBotTokensByCabinet.delete(cabinetId);

        const prevTok = launchedToken;
        if (
          prevTok &&
          ![...desired.values()].some((c) => c.token === prevTok)
        ) {
          try {
            existingBot.stop('SIGTERM');
          } catch {
            // ignore
          }
          this.logger.log(
            `Telegram bot stopped: token no longer used by any cabinet (had cabinet=${cabinetId})`,
          );
        }
      }

      /** Один Bot API токен = один long polling; иначе второй `launch()` зависает на 60+ с. */
      const tokenToCabinetIds = new Map<string, string[]>();
      for (const [cabinetId, cfg] of desired.entries()) {
        const list = tokenToCabinetIds.get(cfg.token);
        if (list) {
          list.push(cabinetId);
        } else {
          tokenToCabinetIds.set(cfg.token, [cabinetId]);
        }
      }

      const attachSharedTokenCabinets = (
        landed: Telegraf,
        token: string,
        cabinetIds: string[],
        skipCabinetId: string | null,
      ): void => {
        for (const cid of cabinetIds) {
          if (skipCabinetId && cid === skipCabinetId) {
            continue;
          }
          if (this.launchedBotTokensByCabinet.get(cid) === token) {
            continue;
          }
          const cfg = desired.get(cid);
          if (!cfg) continue;
          this.resetCabinetLaunchFailureTracking(cid);
          this.botRegistry.addLaunchedBot(cid, landed);
          this.launchedBotTokensByCabinet.set(cid, token);
          this.logger.log(
            `Telegram bot: cabinet=${cid} (${cfg.name}) syncId=${syncId} shares running bot instance with same token`,
          );
          void this.sendStartupGreetingForCabinet(cid).catch((e) =>
            this.logger.warn(
              `sendStartupGreetingForCabinet failed cabinet=${cid}: ${formatError(e)}`,
            ),
          );
        }
      };

      for (const [token, cabinetIds] of tokenToCabinetIds.entries()) {
        const allReady = cabinetIds.every(
          (cid) => this.launchedBotTokensByCabinet.get(cid) === token,
        );
        if (allReady) {
          continue;
        }

        let reuseBot: Telegraf | null = null;
        for (const cid of cabinetIds) {
          if (this.launchedBotTokensByCabinet.get(cid) === token) {
            reuseBot = this.botRegistry.getScopedBotOnly(cid) ?? null;
            if (reuseBot) break;
          }
        }
        if (reuseBot) {
          attachSharedTokenCabinets(reuseBot, token, cabinetIds, null);
          continue;
        }

        const leaderId = cabinetIds[0];
        if (!leaderId) {
          continue;
        }
        const leaderCfg = desired.get(leaderId);
        if (!leaderCfg) {
          continue;
        }

        const bot = new Telegraf(token, {
          handlerTimeout: 180_000,
        });
        bot.catch((err, ctx) => {
          const msg = err instanceof Error ? err.message : String(err);
          const stack = err instanceof Error ? err.stack : undefined;
          this.logger.error(
            `Telegraf unhandled error (tokenLeaderCabinet=${leaderId}): ${msg} updateType=${ctx?.updateType ?? '?'}`,
            stack,
          );
          void this.appLog.append('error', 'telegram', 'Telegraf unhandled error', {
            cabinetId: leaderId,
            errorMessage: msg,
            updateType: ctx?.updateType ?? '?',
            stack: stack ? stack.slice(0, 800) : undefined,
          });
          void ctx
            ?.reply(
              'Произошла ошибка при обработке сообщения. Проверьте логи сервера (TelegramService).',
            )
            .catch((e) =>
              this.logger.warn(`Could not reply with error to user: ${String(e)}`),
            );
        });
        this.registerHandlers(bot, token);
        if (cabinetIds.length > 1) {
          this.logger.log(
            `Telegram bot: один launch для токена, кабинетов=${cabinetIds.length} syncId=${syncId} leader=${leaderId} (${leaderCfg.name})`,
          );
        }
        try {
          await this.launchCabinetBotWithTimeout(bot, leaderId, leaderCfg, syncId);
          const landed = this.botRegistry.getScopedBotOnly(leaderId);
          if (landed) {
            attachSharedTokenCabinets(landed, token, cabinetIds, leaderId);
          }
        } catch {
          const fc = (this.cabinetLaunchConsecutiveFailures.get(leaderId) ?? 0) + 1;
          this.cabinetLaunchConsecutiveFailures.set(leaderId, fc);
          this.cabinetLaunchRecoveryPending.add(leaderId);
          this.scheduleCabinetLaunchRetryAfterFailure(leaderId);
        }
      }

      const first = this.botRegistry.values().next().value ?? null;
      this.botRegistry.setPrimaryBot(first);
      return this.botRegistry.launchedCount;
    } finally {
      this.botSyncInFlight = false;
    }
  }

  /** Таймаут только для `bot.launch()` (getUpdates), мс; `deleteWebhook` — отдельно (`TELEGRAM_BOT_DELETE_WEBHOOK_TIMEOUT_MS`). */
  private telegramLaunchTimeoutMs(): number {
    const raw = process.env.TELEGRAM_BOT_LAUNCH_TIMEOUT_MS?.trim();
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return 60_000;
    return Math.min(180_000, Math.max(5_000, n));
  }

  /** Пауза между последовательными запусками ботов (мс). `0` — без паузы. Пусто — 2000. */
  private telegramLaunchStaggerMs(): number {
    const raw = process.env.TELEGRAM_BOT_LAUNCH_STAGGER_MS?.trim();
    if (raw === undefined || raw === '') {
      return 2_000;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) {
      return 2_000;
    }
    if (n === 0) {
      return 0;
    }
    return Math.min(120_000, n);
  }

  private async sleepCabinetLaunchStaggerIfNeeded(): Promise<void> {
    const stagger = this.telegramLaunchStaggerMs();
    if (stagger <= 0 || this.lastCabinetBotLaunchFinishedAt <= 0) {
      return;
    }
    const elapsed = Date.now() - this.lastCabinetBotLaunchFinishedAt;
    const wait = Math.max(0, stagger - elapsed);
    if (wait > 0) {
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private telegramDeleteWebhookTimeoutMs(): number {
    const raw = process.env.TELEGRAM_BOT_DELETE_WEBHOOK_TIMEOUT_MS?.trim();
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return 30_000;
    return Math.min(120_000, Math.max(5_000, n));
  }

  private async promiseWithTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    if (!(ms > 0)) {
      return await p;
    }
    return await new Promise<T>((resolve, reject) => {
      const tid = setTimeout(() => {
        reject(new Error(`Telegram operation timeout after ${ms}ms`));
      }, ms);
      void p.then(
        (v) => {
          clearTimeout(tid);
          resolve(v);
        },
        (e) => {
          clearTimeout(tid);
          reject(e);
        },
      );
    });
  }

  /**
   * Сброс трекинга неудачных launch: таймер retry, счётчик, флаг recovery для AppLog.
   * @returns true если до сброса ожидалась запись «recovered» в AppLog.
   */
  private resetCabinetLaunchFailureTracking(cabinetId: string): boolean {
    const hadRecovery = this.cabinetLaunchRecoveryPending.has(cabinetId);
    const t = this.cabinetLaunchRetryTimers.get(cabinetId);
    if (t) {
      clearTimeout(t);
      this.cabinetLaunchRetryTimers.delete(cabinetId);
    }
    this.cabinetLaunchConsecutiveFailures.delete(cabinetId);
    this.cabinetLaunchRecoveryPending.delete(cabinetId);
    return hadRecovery;
  }

  private scheduleCabinetLaunchRetryAfterFailure(cabinetId: string): void {
    if (this.shuttingDown) {
      return;
    }
    const existing = this.cabinetLaunchRetryTimers.get(cabinetId);
    if (existing) {
      clearTimeout(existing);
      this.cabinetLaunchRetryTimers.delete(cabinetId);
    }
    const fc = this.cabinetLaunchConsecutiveFailures.get(cabinetId) ?? 1;
    const delays = TELEGRAM_CABINET_LAUNCH_RETRY_DELAYS_MS;
    const delayMs = delays[Math.min(Math.max(0, fc - 1), delays.length - 1)];
    const timer = setTimeout(() => {
      this.cabinetLaunchRetryTimers.delete(cabinetId);
      void (async () => {
        for (let i = 0; i < 24 && this.botSyncInFlight && !this.shuttingDown; i++) {
          await new Promise((r) => setTimeout(r, 250));
        }
        await this.syncBotsWithCabinetTokens().catch((e) =>
          this.logger.warn(
            `Telegram cabinet launch retry sync failed cabinet=${cabinetId}: ${formatError(e)}`,
          ),
        );
      })();
    }, delayMs);
    this.cabinetLaunchRetryTimers.set(cabinetId, timer);
    this.logger.log(
      `Telegram cabinet launch retry scheduled cabinet=${cabinetId} in ${delayMs}ms (consecutiveFailures=${fc})`,
    );
  }

  private async appendCabinetLaunchAppLog(
    cabinetId: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    payload: unknown,
  ): Promise<void> {
    await this.cabinetContext.runWithCabinetAsync(cabinetId, () =>
      this.appLog.append(level, 'telegram', message, payload),
    );
  }

  private async withTelegramBotLaunchSerialized<T>(fn: () => Promise<T>): Promise<T> {
    const prevGate = this.botLaunchSerialGate;
    let release!: () => void;
    this.botLaunchSerialGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prevGate.catch(() => {});
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Снять все кабинеты, указывающие на этот экземпляр Telegraf (reuse токена / откат при сбое launch). */
  private unlinkTelegrafFromAllCabinets(bot: Telegraf): void {
    for (const [cid, b] of [...this.botRegistry.entries()]) {
      if (b === bot) {
        this.botRegistry.removeCabinetBot(cid);
        this.launchedBotTokensByCabinet.delete(cid);
      }
    }
  }

  private async launchCabinetBotWithTimeout(
    bot: Telegraf,
    cabinetId: string,
    cfg: { token: string; name: string },
    syncId: string,
  ): Promise<void> {
    const correlationId = makeTelegramBotLaunchCorrelationId();
    const tokenMask = maskTelegramBotToken(cfg.token);
    const launchRequestedAt = performance.now();
    const deleteWebhookMs = this.telegramDeleteWebhookTimeoutMs();

    await this.withTelegramBotLaunchSerialized(async () => {
      const queueWaitMs = Math.round(performance.now() - launchRequestedAt);
      this.logger.log(
        `Telegram bot launch phase=launch_gate_ok cabinet=${cabinetId} (${cfg.name}) syncId=${syncId} correlationId=${correlationId} queueWaitMs=${queueWaitMs} tokenMask=${tokenMask}`,
      );

      const staggerBefore = performance.now();
      await this.sleepCabinetLaunchStaggerIfNeeded();
      const staggerWaitMs = Math.round(performance.now() - staggerBefore);
      this.logger.log(
        `Telegram bot launch phase=launch_stagger cabinet=${cabinetId} syncId=${syncId} correlationId=${correlationId} staggerWaitMs=${staggerWaitMs}`,
      );

      let activePhase: TelegramLaunchTimedOutPhase = 'unknown';
      try {
        activePhase = 'delete_webhook';
        const dwStart = performance.now();
        this.logger.log(
          `Telegram bot launch phase=delete_webhook_start cabinet=${cabinetId} syncId=${syncId} correlationId=${correlationId} timeoutMs=${deleteWebhookMs}`,
        );
        await this.promiseWithTimeout(
          bot.telegram.deleteWebhook({ drop_pending_updates: false }),
          deleteWebhookMs,
        );
        const dwMs = Math.round(performance.now() - dwStart);
        this.logger.log(
          `Telegram bot launch phase=delete_webhook_ok cabinet=${cabinetId} syncId=${syncId} correlationId=${correlationId} durationMs=${dwMs}`,
        );
      } catch (e) {
        const errText = formatError(e);
        this.logger.error(
          `Telegram bot launch phase failed activePhase=${activePhase} cabinet=${cabinetId} syncId=${syncId} correlationId=${correlationId}: ${errText}`,
        );
        void this.appendCabinetLaunchAppLog(
          cabinetId,
          'warn',
          `Telegram bot launch failed activePhase=${activePhase}: ${errText}`,
          {
            syncId,
            correlationId,
            cabinetId,
            activePhase,
            deleteWebhookTimeoutMs: deleteWebhookMs,
          },
        ).catch(() => {});
        try {
          bot.stop('SIGTERM');
        } catch {
          // ignore
        }
        throw e;
      } finally {
        this.lastCabinetBotLaunchFinishedAt = Date.now();
      }
    });

    /**
     * `bot.launch()` при long polling ждёт бесконечный цикл getUpdates — нельзя держать под
     * `withTelegramBotLaunchSerialized`, иначе остальные кабинеты не стартуют до таймаута race на launch.
     */
    let me: { username?: string } | null = null;
    try {
      const verifyMs = Math.min(120_000, Math.max(5_000, this.telegramLaunchTimeoutMs()));
      me = await this.promiseWithTimeout(bot.telegram.getMe(), verifyMs);
    } catch (e) {
      const errText = formatError(e);
      this.logger.error(
        `Telegram bot getMe failed before polling cabinet=${cabinetId} syncId=${syncId} correlationId=${correlationId}: ${errText}`,
      );
      void this.appendCabinetLaunchAppLog(
        cabinetId,
        'warn',
        `Telegram bot getMe failed: ${errText}`,
        { syncId, correlationId, cabinetId },
      ).catch(() => {});
      try {
        bot.stop('SIGTERM');
      } catch {
        // ignore
      }
      throw e;
    }

    const hadRecovery = this.resetCabinetLaunchFailureTracking(cabinetId);
    this.botRegistry.addLaunchedBot(cabinetId, bot);
    this.launchedBotTokensByCabinet.set(cabinetId, cfg.token);

    void bot.launch().catch(async (e) => {
      const errText = formatError(e);
      this.logger.error(
        `Telegram bot polling launch failed cabinet=${cabinetId} syncId=${syncId} correlationId=${correlationId}: ${errText}`,
      );
      void this.appendCabinetLaunchAppLog(
        cabinetId,
        'warn',
        `Telegram bot polling launch failed: ${errText}`,
        {
          syncId,
          correlationId,
          cabinetId,
        },
      ).catch(() => {});
      this.unlinkTelegrafFromAllCabinets(bot);
      try {
        bot.stop('SIGTERM');
      } catch {
        // ignore
      }
      const fc = (this.cabinetLaunchConsecutiveFailures.get(cabinetId) ?? 0) + 1;
      this.cabinetLaunchConsecutiveFailures.set(cabinetId, fc);
      this.cabinetLaunchRecoveryPending.add(cabinetId);
      this.scheduleCabinetLaunchRetryAfterFailure(cabinetId);
    });

    const totalMs = Math.round(performance.now() - launchRequestedAt);
    this.logger.log(
      `Telegram bot launch phase=launch_complete cabinet=${cabinetId} (${cfg.name}) syncId=${syncId} correlationId=${correlationId} totalMs=${totalMs} username=@${me?.username ?? '?'} (long polling не блокирует очередь других токенов)`,
    );
    if (hadRecovery) {
      void this.appendCabinetLaunchAppLog(
        cabinetId,
        'info',
        'Telegram bot launch recovered after previous failure',
        {
          syncId,
          correlationId,
          cabinetId,
          totalMs,
          username: me?.username ?? null,
        },
      ).catch(() => {});
    }
    void this.sendStartupGreetingForCabinet(cabinetId).catch((err) =>
      this.logger.warn(
        `sendStartupGreetingForCabinet failed cabinet=${cabinetId}: ${formatError(err)}`,
      ),
    );
  }

  private async resolveStartupGreetingText(): Promise<string> {
    return (
      (await this.settings.get('TELEGRAM_STARTUP_MESSAGE')) ??
      [
        'SignalsBot запущен.',
        'Отправьте сигнал текстом, фото или голосом.',
        'Если данных мало — ответьте на вопросы бота; контекст сохраняется до «Подтвердить».',
        'Команды: /cancel — отменить черновик.',
      ].join('\n')
    );
  }

  /**
   * Приветствие при подъёме assist-бота кабинета (long polling или присоединение к уже запущенному
   * экземпляру с тем же токеном). Доставка как у проактивных уведомлений: whitelist ∪ владелец ∪ участники.
   */
  private async sendStartupGreetingForCabinet(cabinetId: string): Promise<void> {
    const bot = this.botRegistry.getScopedBotOnly(cabinetId);
    if (!bot) {
      return;
    }
    const ids = await this.resolveCabinetTelegramNotifyRecipientIds(cabinetId);
    if (ids.length === 0) {
      return;
    }
    const text = await this.resolveStartupGreetingText();
    try {
      const me = await bot.telegram.getMe();
      this.logger.log(
        `sendStartupGreeting: cabinet=${cabinetId} bot @${me.username ?? '?'} (id=${me.id}), users=${ids.join(', ')}`,
      );
    } catch (e) {
      this.logger.error(
        `sendStartupGreeting: getMe failed cabinet=${cabinetId}: ${e instanceof Error ? e.message : e}`,
      );
      return;
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const id of ids) {
      try {
        await bot.telegram.sendMessage(id, text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `Startup greeting failed cabinet=${cabinetId} chat_id=${id}: ${msg}`,
        );
      }
    }
  }

  /** Уведомление всех кабинетов с запущенным ботом (legacy-путь перезапуска primary). */
  private async sendStartupGreeting(): Promise<void> {
    if (this.botRegistry.launchedCount === 0) {
      return;
    }
    for (const [cabinetId] of this.botRegistry.entries()) {
      await this.sendStartupGreetingForCabinet(cabinetId);
    }
  }

  /**
   * Как `SettingsService.get('TELEGRAM_WHITELIST')`: сначала CabinetSetting, затем env/глобальные слои.
   * Прямой запрос в Prisma обходил `TELEGRAM_WHITELIST` из окружения — userbot-уведомления молчали, а VK-зеркало (через settings.get) работало.
   */
  private async getWhitelistUserIdsForCabinet(cabinetId: string): Promise<number[]> {
    const raw = await this.cabinetContext.runWithCabinet(cabinetId, async () =>
      String((await this.settings.get('TELEGRAM_WHITELIST')) ?? '').trim(),
    );
    return parseTelegramWhitelistUserIds(raw);
  }

  /**
   * Исходящие уведомления бота: TELEGRAM_WHITELIST ∪ Telegram владельца кабинета ∪ активные участники.
   * Команды дополнительно разрешены любому AuthUser с тем же telegramUserId (`isAllowed`), поэтому без
   * записи в whitelist сообщения об ошибках раньше не уходили — этот список закрывает типичный случай.
   */
  async listCabinetTelegramNotifyRecipientIds(cabinetId: string): Promise<number[]> {
    return this.resolveCabinetTelegramNotifyRecipientIds(cabinetId);
  }

  private async resolveCabinetTelegramNotifyRecipientIds(cabinetId: string): Promise<number[]> {
    const whitelist = await this.getWhitelistUserIdsForCabinet(cabinetId);
    const linked = await this.collectCabinetLinkedTelegramNotifyChatIds(cabinetId);
    return mergeDistinctFiniteNumericIds([...whitelist, ...linked]);
  }

  private async collectCabinetLinkedTelegramNotifyChatIds(cabinetId: string): Promise<number[]> {
    const out: number[] = [];
    const cabinet = await this.prisma.cabinet.findUnique({
      where: { id: cabinetId },
      select: { ownerUserId: true },
    });
    if (cabinet?.ownerUserId) {
      const owner = await this.prisma.authUser.findUnique({
        where: { id: cabinet.ownerUserId },
        select: { telegramUserId: true },
      });
      const n = parseStoredTelegramUserIdAsChatId(owner?.telegramUserId);
      if (n !== null) out.push(n);
    }
    const members = await this.prisma.cabinetMember.findMany({
      where: { cabinetId, isActive: true },
      select: { telegramUserId: true },
    });
    for (const m of members) {
      const n = parseStoredTelegramUserIdAsChatId(m.telegramUserId);
      if (n !== null) out.push(n);
    }
    return out;
  }

  private async getTelegramNotifyRecipientIds(): Promise<number[]> {
    const cabinetId = this.currentCabinetId();
    if (!cabinetId) {
      return [];
    }
    return this.resolveCabinetTelegramNotifyRecipientIds(cabinetId);
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.botSyncTimer) {
      clearInterval(this.botSyncTimer);
      this.botSyncTimer = null;
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    if (this.botLaunchRetryTimer) {
      clearTimeout(this.botLaunchRetryTimer);
      this.botLaunchRetryTimer = null;
    }
    for (const t of this.cabinetLaunchRetryTimers.values()) {
      clearTimeout(t);
    }
    this.cabinetLaunchRetryTimers.clear();
    this.cabinetLaunchConsecutiveFailures.clear();
    this.cabinetLaunchRecoveryPending.clear();
    for (const bot of this.botRegistry.values()) {
      bot.stop('SIGTERM');
    }
    this.launchedBotTokensByCabinet.clear();
    this.botRegistry.clear();
    this.telegramHeavyInboundChains.clear();
  }

  /**
   * Исходящие уведомления кабинета: Telegraf из реестра (long polling в этом процессе), иначе
   * временный клиент по TELEGRAM_BOT_TOKEN кабинета — тот же бот, без подмены «primary» другого кабинета;
   * доставка с реплики API, где нет запущенного getUpdates.
   */
  private async getCabinetOutboundTelegraf(cabinetId: string): Promise<Telegraf | null> {
    const scoped = this.botRegistry.getScopedBotOnly(cabinetId);
    if (scoped) {
      return scoped;
    }
    const token = await this.cabinetContext.runWithCabinetAsync(
      cabinetId,
      async () => String((await this.settings.get('TELEGRAM_BOT_TOKEN')) ?? '').trim(),
    );
    if (!token) {
      return null;
    }
    return new Telegraf(token, {
      handlerTimeout: 180_000,
    });
  }

  async broadcastCabinetPlainMessage(params: {
    cabinetId: string;
    text: string;
    keyboard?: ReturnType<typeof import('../utils/telegram-keyboards.util').spotBuyPromptKeyboard>;
  }): Promise<{ ok: boolean; deliveredTo: number; error?: string }> {
    return this.cabinetContext.runWithCabinetAsync(params.cabinetId, async () => {
      const bot = await this.getCabinetOutboundTelegraf(params.cabinetId);
      if (!bot) {
        return {
          ok: false,
          deliveredTo: 0,
          error: 'Нет TELEGRAM_BOT_TOKEN для кабинета',
        };
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error: 'Нет получателей уведомлений',
        };
      }
      let deliveredTo = 0;
      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(uid, params.text, params.keyboard ?? undefined);
          deliveredTo += 1;
        } catch (e) {
          this.logTelegramBroadcastRecipientError('broadcastCabinetPlainMessage', uid, e);
        }
      }
      if (deliveredTo === 0) {
        return { ok: false, deliveredTo: 0, error: 'Не удалось доставить сообщение' };
      }
      return { ok: true, deliveredTo };
    });
  }

  async sendCabinetUserPlainMessage(
    cabinetId: string,
    userId: number,
    text: string,
  ): Promise<void> {
    await this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const bot = await this.getCabinetOutboundTelegraf(cabinetId);
      if (!bot) {
        return;
      }
      await bot.telegram.sendMessage(userId, text).catch(() => undefined);
    });
  }

  private async getBotForTelegramUserId(telegramUserIdRaw: string): Promise<Telegraf | null> {
    const telegramUserId = String(telegramUserIdRaw ?? '').trim();
    if (!telegramUserId) {
      const def = await this.cabinets.getDefaultCabinetId();
      return def ? await this.getCabinetOutboundTelegraf(def) : null;
    }
    const authUser = await this.prisma.authUser.findFirst({
      where: { telegramUserId },
      select: { id: true },
    });
    if (!authUser?.id) {
      const def = await this.cabinets.getDefaultCabinetId();
      return def ? await this.getCabinetOutboundTelegraf(def) : null;
    }
    const cabinet = await this.prisma.cabinet.findFirst({
      where: { ownerUserId: authUser.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!cabinet?.id) {
      const def = await this.cabinets.getDefaultCabinetId();
      return def ? await this.getCabinetOutboundTelegraf(def) : null;
    }
    return await this.getCabinetOutboundTelegraf(cabinet.id);
  }

  async sendPasswordResetCode(params: {
    telegramUserId: string;
    login: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<{ ok: boolean; error?: string }> {
    const bot = await this.getBotForTelegramUserId(params.telegramUserId);
    if (!bot) {
      return {
        ok: false,
        error:
          'Нет TELEGRAM_BOT_TOKEN для кабинета (настройки или env) — код не отправлен',
      };
    }
    const userId = Number(params.telegramUserId);
    if (!Number.isFinite(userId)) {
      return { ok: false, error: 'Некорректный telegramUserId' };
    }
    const text =
      `Код восстановления пароля\n` +
      `Логин: ${params.login}\n` +
      `Код: ${params.code}\n` +
      `Действует: ${params.expiresInMinutes} мин.\n\n` +
      `Если это были не вы — проигнорируйте сообщение.`;
    try {
      await bot.telegram.sendMessage(userId, text);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatError(e) };
    }
  }

  private startMemoryCleanupLoop(): void {
    if (this.cleanupTimer) return;
    // Очищаем in-memory структуры, чтобы они не росли бесконечно при долгом аптайме.
    this.cleanupTimer = setInterval(() => {
      try {
        const now = Date.now();
        const { expiredDrafts, removedExternal } =
          this.conversationState.runMemoryCleanup(now);
        if (expiredDrafts > 0 || removedExternal > 0) {
          this.logger.log(
            `TelegramService: cleaned draftsExpired=${expiredDrafts} externalConfirmations=${removedExternal}`,
          );
        }
      } catch (e) {
        this.logger.warn(`TelegramService cleanup loop failed: ${formatError(e)}`);
      }
    }, 60_000);
  }

  private async launchBotWithRetry(): Promise<void> {
    const bot = this.botRegistry.getPrimaryBot();
    if (!bot || this.shuttingDown) {
      return;
    }
    try {
      await bot.launch();
      this.logger.log(
        'Telegram bot started (long polling, handlerTimeout=180s)',
      );
      await this.sendStartupGreeting();
    } catch (e) {
      const err = formatError(e);
      this.logger.error(`Telegram bot launch failed: ${err}`);
      if (this.shuttingDown) {
        return;
      }
      if (this.botLaunchRetryTimer) {
        clearTimeout(this.botLaunchRetryTimer);
      }
      // Транзиентные DNS/сеть (например EAI_AGAIN) не должны падать фатально:
      // переподнимаем launch через короткий интервал.
      this.botLaunchRetryTimer = setTimeout(() => {
        this.botLaunchRetryTimer = null;
        void this.launchBotWithRetry();
      }, 10_000);
      this.logger.warn('Telegram launch retry scheduled in 10s');
    }
  }

  private async isAllowed(userId: number): Promise<boolean> {
    const ids = await this.getWhitelistUserIds();
    if (ids.includes(userId)) {
      return true;
    }
    const linkedUser = await this.prisma.authUser.findFirst({
      where: { telegramUserId: String(userId) },
      select: { id: true },
    });
    return Boolean(linkedUser?.id);
  }

  /**
   * Не блокирует compositor Telegraf: `handler` выполняется под контекстом кабинета и в очереди
   * на пару (cabinetId, uid), чтобы один Telegram-пользователь в нескольких кабинетах не делил одну цепочку LLM.
   */
  private scheduleTelegramHeavyInbound(
    uid: number,
    cabinetId: string,
    label: string,
    ctx: Context,
    handler: () => Promise<void>,
  ): void {
    const chainKey = `${cabinetId}:${uid}`;
    const prev = this.telegramHeavyInboundChains.get(chainKey) ?? Promise.resolve();
    const job = prev
      .then(() => this.cabinetContext.runWithCabinetAsync(cabinetId, handler))
      .catch(async (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `Telegram deferred inbound (${label}) userId=${uid} cabinet=${cabinetId}: ${msg}`,
          e instanceof Error ? e.stack : undefined,
        );
        try {
          await ctx.reply(`Ошибка бота: ${msg}`);
        } catch (replyErr) {
          this.logger.warn(`TG deferred ctx.reply failed: ${formatError(replyErr)}`);
        }
      });
    this.telegramHeavyInboundChains.set(chainKey, job);
    void job.finally(() => {
      if (this.telegramHeavyInboundChains.get(chainKey) === job) {
        this.telegramHeavyInboundChains.delete(chainKey);
      }
    });
  }

  /**
   * Рассылка в несколько chatId: часть получателей без /start или с блокировкой бота — ожидаемо;
   * не путаем с фатальной ошибкой, если остальным доставка прошла.
   */
  private logTelegramBroadcastRecipientError(
    label: string,
    uid: number,
    e: unknown,
  ): void {
    const fe = formatError(e);
    const low = fe.toLowerCase();
    const benignPrivate =
      low.includes('chat not found') ||
      low.includes('bot was blocked by the user') ||
      low.includes('blocked by user') ||
      low.includes('user is deactivated') ||
      low.includes('peer_id_invalid');
    if (benignPrivate) {
      this.logger.log(
        `${label}: пропуск chatId=${uid} (${fe}). Обычно: не открыт диалог с этим ботом (/start) или блокировка; другие получатели списка могут получить сообщение.`,
      );
      return;
    }
    this.logger.warn(`${label} -> ${uid}: ${fe}`);
  }

  private async runWithUserCabinet<T>(userId: number, fn: () => Promise<T>): Promise<T> {
    const cabinetId = await this.cabinets.resolveCabinetForTelegramUser(userId);
    return this.cabinetContext.runWithCabinet(cabinetId, fn);
  }

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  private async resolveCabinetDisplayLabel(): Promise<string> {
    const cabinetId =
      this.currentCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    return this.cabinets.getCabinetDisplayLabel(cabinetId);
  }

  private cabinetNotifyHtmlPrefix(label: string): string {
    return `<b>Кабинет:</b> <code>${escapeTelegramHtml(label)}</code>\n\n`;
  }

  private cabinetNotifyPlainPrefix(label: string): string {
    return `Кабинет: ${label}\n\n`;
  }

  private async getWhitelistUserIds(): Promise<number[]> {
    const cabinetId = this.currentCabinetId();
    if (!cabinetId) {
      return [];
    }
    return this.getWhitelistUserIdsForCabinet(cabinetId);
  }

  async requestExternalSignalConfirmation(params: {
    ingestId: string;
    signal: SignalDto;
    rawMessage?: string;
    onResult?: (result: ExternalConfirmationResult) => Promise<void> | void;
  }): Promise<{ ok: boolean; requestId?: string; deliveredTo: number; error?: string }> {
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    if (!cabinetId) {
      return { ok: false, deliveredTo: 0, error: 'Кабинет не выбран' };
    }
    return await this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const bot = await this.getCabinetOutboundTelegraf(cabinetId);
      if (!bot) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет TELEGRAM_BOT_TOKEN для кабинета (настройки или env) — уведомление не отправлено',
        };
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет получателей уведомлений (TELEGRAM_WHITELIST или Telegram владельца/участников кабинета)',
        };
      }
      const requestId = makeExternalRequestKey(cabinetId, params.ingestId);
      this.conversationState.externalConfirmations.set(requestId, {
        requestId,
        cabinetId,
        ingestId: params.ingestId,
        signal: params.signal,
        rawMessage: params.rawMessage,
        createdAt: Date.now(),
        onResult: params.onResult,
      });

      let deliveredTo = 0;
      const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
      const cabinetLabel = await this.resolveCabinetDisplayLabel();
      const msg =
        this.cabinetNotifyPlainPrefix(cabinetLabel) +
        formatExternalSignalTable(params.signal, defaultOrderUsd);
      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(
            uid,
            msg,
            externalConfirmKeyboard(requestId),
          );
          deliveredTo += 1;
        } catch (e) {
          this.logTelegramBroadcastRecipientError('requestExternalSignalConfirmation', uid, e);
        }
      }
      if (deliveredTo === 0) {
        this.conversationState.externalConfirmations.delete(requestId);
        return {
          ok: false,
          deliveredTo: 0,
          error: 'Не удалось доставить подтверждение ни одному пользователю',
        };
      }
      return { ok: true, requestId, deliveredTo };
    });
  }

  async notifyUserbotSignalFailure(params: {
    ingestId: string;
    /** ID чата в Telegram (для трассировки, если название неизвестно) */
    chatId: string;
    /** Название группы/канала из userbot (TgUserbotChat.title), если есть */
    groupTitle?: string;
    token: string;
    stage: 'classify' | 'transcript' | 'bybit' | 'ingest';
    error: string;
    missingData?: string[];
  }): Promise<{ ok: boolean; deliveredTo: number; error?: string }> {
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    if (!cabinetId) {
      return { ok: false, deliveredTo: 0, error: 'Кабинет не выбран' };
    }
    return await this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const cabinetLabel = await this.resolveCabinetDisplayLabel();
      const msg =
        this.cabinetNotifyPlainPrefix(cabinetLabel) +
        formatUserbotSignalFailureMessage(params);

      const bot = await this.getCabinetOutboundTelegraf(cabinetId);
      if (!bot) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет TELEGRAM_BOT_TOKEN для кабинета (настройки или env) — уведомление не отправлено',
        };
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет получателей уведомлений (TELEGRAM_WHITELIST или Telegram владельца/участников кабинета)',
        };
      }

      let deliveredTo = 0;
      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(uid, msg);
          deliveredTo += 1;
        } catch (e) {
          this.logTelegramBroadcastRecipientError('notifyUserbotSignalFailure', uid, e);
        }
      }

      if (deliveredTo === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error: 'Не удалось доставить ошибку ни одному пользователю',
        };
      }
      return { ok: true, deliveredTo };
    });
  }

  /**
   * Короткий тест доставки в Telegram тем же списком получателей, что и оповещения userbot (whitelist ∪ владелец ∪ участники).
   */
  async notifyDiagnosticsPing(): Promise<{ ok: boolean; deliveredTo: number; error?: string }> {
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    if (!cabinetId) {
      return { ok: false, deliveredTo: 0, error: 'Кабинет не выбран' };
    }
    return await this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const cabinetLabel = await this.resolveCabinetDisplayLabel();
      const msg =
        this.cabinetNotifyPlainPrefix(cabinetLabel) +
        '🧪 Тест уведомлений со страницы «Диагностика».\n\n' +
        'Если вы видите это сообщение — бот запущен и список получателей для оповещений настроен.';

      const bot = await this.getCabinetOutboundTelegraf(cabinetId);
      if (!bot) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет TELEGRAM_BOT_TOKEN для кабинета (настройки или env) — уведомление не отправлено',
        };
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет получателей уведомлений (TELEGRAM_WHITELIST или Telegram владельца/участников кабинета)',
        };
      }

      let deliveredTo = 0;
      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(uid, msg);
          deliveredTo += 1;
        } catch (e) {
          this.logTelegramBroadcastRecipientError('notifyDiagnosticsPing', uid, e);
        }
      }

      if (deliveredTo === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Не удалось доставить тест ни одному пользователю (например, диалог с ботом не открыт)',
        };
      }
      return { ok: true, deliveredTo };
    });
  }

  async notifyUserbotResultWithoutEntry(params: {
    ingestId: string;
    chatId: string;
    groupTitle?: string;
    pair: string;
    signalId: string;
    resultMessageText: string;
    quotedSnippet?: string;
  }): Promise<{ ok: boolean; deliveredTo: number; error?: string }> {
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    if (!cabinetId) {
      return { ok: false, deliveredTo: 0, error: 'Кабинет не выбран' };
    }
    return await this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const bot = await this.getCabinetOutboundTelegraf(cabinetId);
      if (!bot) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет TELEGRAM_BOT_TOKEN для кабинета (настройки или env) — уведомление не отправлено',
        };
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет получателей уведомлений (TELEGRAM_WHITELIST или Telegram владельца/участников кабинета)',
        };
      }
      const cabinetLabel = await this.resolveCabinetDisplayLabel();
      const msg =
        this.cabinetNotifyHtmlPrefix(cabinetLabel) +
        formatUserbotResultWithoutEntryHtml(params);

      let deliveredTo = 0;
      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(uid, msg, {
            parse_mode: 'HTML',
            ...staleResultCancelKeyboard(params.signalId),
          });
          deliveredTo += 1;
        } catch (e) {
          this.logTelegramBroadcastRecipientError('notifyUserbotResultWithoutEntry', uid, e);
        }
      }

      if (deliveredTo === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error: 'Не удалось доставить уведомление о result без входа ни одному пользователю',
        };
      }
      return { ok: true, deliveredTo };
    });
  }

  async notifyApiTradeCancelled(params: {
    signalId: string;
    pair: string;
    direction: string;
    entries: number[];
    /** true — зона [low,high]; false — DCA; не передавать — нейтральная подпись */
    entryIsRange?: boolean;
    stopLoss: number;
    takeProfits: number[];
    leverage: number;
    orderUsd: number;
    capitalPercent: number;
    source?: string | null;
    reason?: string;
  }): Promise<{ ok: boolean; deliveredTo: number; error?: string }> {
    const raw = (await this.settings.get('TELEGRAM_NOTIFY_API_TRADE_CANCELLED'))
      ?.trim()
      .toLowerCase();
    const explicitlyOff =
      raw === 'false' || raw === '0' || raw === 'no' || raw === 'off';
    if (explicitlyOff) {
      return { ok: true, deliveredTo: 0 };
    }
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    if (!cabinetId) {
      return { ok: false, deliveredTo: 0, error: 'Кабинет не выбран' };
    }
    return await this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const bot = await this.getCabinetOutboundTelegraf(cabinetId);
      if (!bot) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет TELEGRAM_BOT_TOKEN для кабинета (настройки или env) — уведомление не отправлено',
        };
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет получателей уведомлений (TELEGRAM_WHITELIST или Telegram владельца/участников кабинета)',
        };
      }
      const cabinetLabel = await this.resolveCabinetDisplayLabel();
      const msg =
        this.cabinetNotifyHtmlPrefix(cabinetLabel) +
        formatApiTradeCancelledHtml(params);

      let deliveredTo = 0;
      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML' });
          deliveredTo += 1;
        } catch (e) {
          this.logTelegramBroadcastRecipientError('notifyApiTradeCancelled', uid, e);
        }
      }
      if (deliveredTo === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error: 'Не удалось доставить уведомление об отмене сделки',
        };
      }
      return { ok: true, deliveredTo };
    });
  }

  async notifyApiTradeLiquidation(params: {
    signalId: string;
    pair: string;
    direction: string;
    leverage: number;
    source?: string | null;
    realizedPnl?: number | null;
  }): Promise<{ ok: boolean; deliveredTo: number; error?: string }> {
    const raw = (await this.settings.get('TELEGRAM_NOTIFY_API_TRADE_LIQUIDATION'))
      ?.trim()
      .toLowerCase();
    const explicitlyOff =
      raw === 'false' || raw === '0' || raw === 'no' || raw === 'off';
    if (explicitlyOff) {
      return { ok: true, deliveredTo: 0 };
    }
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
    if (!cabinetId) {
      return { ok: false, deliveredTo: 0, error: 'Кабинет не выбран' };
    }
    return await this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const bot = await this.getCabinetOutboundTelegraf(cabinetId);
      if (!bot) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет TELEGRAM_BOT_TOKEN для кабинета (настройки или env) — уведомление не отправлено',
        };
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет получателей уведомлений (TELEGRAM_WHITELIST или Telegram владельца/участников кабинета)',
        };
      }

      const cabinetLabel = await this.resolveCabinetDisplayLabel();
      const msg =
        this.cabinetNotifyHtmlPrefix(cabinetLabel) +
        formatApiTradeLiquidationHtml(params);

      let deliveredTo = 0;
      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML' });
          deliveredTo += 1;
        } catch (e) {
          this.logTelegramBroadcastRecipientError('notifyApiTradeLiquidation', uid, e);
        }
      }

      if (deliveredTo === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error: 'Не удалось доставить уведомление о ликвидации',
        };
      }
      return { ok: true, deliveredTo };
    });
  }

  /**
   * Уведомление при размещении второй стороны по паре в hedge-режиме (лонг+шорт одновременно).
   * TELEGRAM_NOTIFY_HEDGE_OPPOSITE_PLACEMENT: false/0/off — не слать.
   */
  async notifyHedgeOppositePlacementAudit(params: {
    symbol: string;
    hedgeModeActive: boolean;
    oppositeOnExchange: boolean;
    existingOppositeDb: {
      id: string;
      pair: string;
      direction: string;
      status: string;
      entries: number[];
      entryIsRange: boolean;
      stopLoss: number;
      takeProfits: number[];
      leverage: number;
      orderUsd: number;
      capitalPercent: number;
      source: string | null;
    } | null;
    newPlaced: {
      signalId: string;
      pair: string;
      direction: string;
      entries: number[];
      entryIsRange?: boolean;
      stopLoss: number;
      takeProfits: number[];
      leverage: number;
      orderUsd: number;
      capitalPercent: number;
      source?: string | null;
    };
  }): Promise<{ ok: boolean; deliveredTo: number; error?: string }> {
    let effectiveCabinetId = this.currentCabinetId();
    if (!effectiveCabinetId) {
      const row = await this.prisma.signal.findFirst({
        where: { id: params.newPlaced.signalId, deletedAt: null },
        select: { cabinetId: true },
      });
      effectiveCabinetId = row?.cabinetId ?? null;
    }
    if (!effectiveCabinetId) {
      this.logger.warn(
        `notifyHedgeOppositePlacementAudit: no cabinet for signalId=${params.newPlaced.signalId}`,
      );
      return { ok: false, deliveredTo: 0, error: 'Кабинет для сигнала не найден' };
    }

    return await this.cabinetContext.runWithCabinetAsync(effectiveCabinetId, async () => {
      const raw = (await this.settings.get('TELEGRAM_NOTIFY_HEDGE_OPPOSITE_PLACEMENT'))
        ?.trim()
        .toLowerCase();
      if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') {
        return { ok: true, deliveredTo: 0 };
      }
      const cabinetLabel = await this.resolveCabinetDisplayLabel();
      const msg =
        this.cabinetNotifyHtmlPrefix(cabinetLabel) +
        formatHedgeOppositePlacementAuditHtml(params);

      const bot = await this.getCabinetOutboundTelegraf(effectiveCabinetId);
      if (!bot) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет TELEGRAM_BOT_TOKEN для кабинета (настройки или env) — уведомление не отправлено',
        };
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error:
            'Нет получателей уведомлений (TELEGRAM_WHITELIST или Telegram владельца/участников кабинета)',
        };
      }
      let deliveredTo = 0;
      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML' });
          deliveredTo += 1;
        } catch (e) {
          this.logTelegramBroadcastRecipientError('notifyHedgeOppositePlacementAudit', uid, e);
        }
      }
      if (deliveredTo === 0) {
        return {
          ok: false,
          deliveredTo: 0,
          error: 'Не удалось доставить уведомление об аудите hedge',
        };
      }
      return { ok: true, deliveredTo };
    });
  }

  /**
   * Уведомление в бота о записи в журнале событий сделки (SignalEvent).
   * По умолчанию включено (TELEGRAM_NOTIFY_TRADE_EVENTS не false/0/off).
   * TELEGRAM_NOTIFY_TRADE_EVENT_TYPES: JSON-массив id типов; пусто = все; [] = ни одного.
   * Не дублирует отдельные уведомления: отмена сделки (уже есть текст «Сделка отменена»),
   * result без входа (уже есть своё сообщение).
   */
  async notifyTradeSignalEvent(params: {
    signalId: string;
    type: string;
    payload?: unknown;
  }): Promise<void> {
    const skipTypes = new Set<string>([
      'BYBIT_TRADE_DELETE_CLEANUP_SUCCESS',
      'USERBOT_RESULT_WITHOUT_ENTRY',
      'BYBIT_HEDGE_OPPOSITE_PLACEMENT_AUDIT',
    ]);
    if (skipTypes.has(params.type)) {
      return;
    }

    let effectiveCabinetId = this.currentCabinetId();
    if (!effectiveCabinetId) {
      const row = await this.prisma.signal.findFirst({
        where: { id: params.signalId, deletedAt: null },
        select: { cabinetId: true },
      });
      effectiveCabinetId = row?.cabinetId ?? null;
    }
    if (!effectiveCabinetId) {
      this.logger.warn(`notifyTradeSignalEvent: no cabinet for signalId=${params.signalId}`);
      return;
    }

    await this.cabinetContext.runWithCabinetAsync(effectiveCabinetId, async () => {
      const raw = (await this.settings.get('TELEGRAM_NOTIFY_TRADE_EVENTS'))
        ?.trim()
        .toLowerCase();
      const off = raw === 'false' || raw === '0' || raw === 'off' || raw === 'no';
      if (off) {
        return;
      }
      const filterRaw = await this.settings.get('TELEGRAM_NOTIFY_TRADE_EVENT_TYPES');
      const evFilter = parseTradeSignalNotifyEventFilter(filterRaw);
      if (evFilter.mode === 'none') {
        return;
      }
      if (evFilter.mode === 'only' && !evFilter.types.has(params.type)) {
        return;
      }

      const title = tradeSignalEventTitleRu(params.type);
      let pairLine = '';
      let sourceLine = '';
      try {
        const sig = await this.prisma.signal.findFirst({
          where: { id: params.signalId, deletedAt: null },
          select: { pair: true, source: true },
        });
        if (sig) {
          const pairU = (sig.pair ?? '').trim().toUpperCase();
          pairLine = `\nПара: <code>${escapeTelegramHtml(pairU)}</code>`;
          const src = sig.source?.trim();
          if (src) {
            sourceLine = `\nИсточник: <code>${escapeTelegramHtml(src)}</code>`;
          }
        }
      } catch {
        // ignore
      }

      let payloadBlock = '';
      if (params.payload !== undefined) {
        const text =
          typeof params.payload === 'string'
            ? params.payload
            : JSON.stringify(params.payload, null, 0);
        const clipped = text.length > 2800 ? `${text.slice(0, 2800)}…` : text;
        payloadBlock = `\n<pre>${escapeTelegramHtml(clipped)}</pre>`;
      }

      const cabinetLabel = await this.resolveCabinetDisplayLabel();
      const msg =
        this.cabinetNotifyHtmlPrefix(cabinetLabel) +
        `<b>${escapeTelegramHtml(title)}</b>\n` +
        `Сделка: <code>${escapeTelegramHtml(params.signalId)}</code>` +
        pairLine +
        sourceLine +
        `\nТип: <code>${escapeTelegramHtml(params.type)}</code>` +
        payloadBlock;

      const bot = await this.getCabinetOutboundTelegraf(effectiveCabinetId);
      if (!bot) {
        this.logger.warn(
          `notifyTradeSignalEvent: нет TELEGRAM_BOT_TOKEN для cabinet=${effectiveCabinetId}`,
        );
        return;
      }
      const ids = await this.getTelegramNotifyRecipientIds();
      if (ids.length === 0) {
        return;
      }

      for (const uid of ids) {
        try {
          await bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML' });
        } catch (e) {
          this.logTelegramBroadcastRecipientError('notifyTradeSignalEvent', uid, e);
        }
      }
    });
  }

  private async clearTelegramInlineKeyboard(ctx: Context): Promise<void> {
    try {
      const anyCtx = ctx as any;
      if (typeof anyCtx.editMessageReplyMarkup === 'function') {
        await anyCtx.editMessageReplyMarkup({ inline_keyboard: [] });
      }
    } catch {
      // ignore (message already edited, no rights, etc.)
    }
  }

  /** Не бросает: истёкший callback, повторный ответ, гонка при нескольких репликах API. */
  private async safeAnswerCbQuery(ctx: Context, text?: string): Promise<void> {
    try {
      await ctx.answerCbQuery(text);
    } catch (e) {
      this.logger.debug(`answerCbQuery skipped: ${formatError(e)}`);
    }
  }

  private registerHandlers(telegraf: Telegraf, botToken: string): void {
    if (!telegraf) return;
    const routing = this.botTokenCabinetRouting.get(botToken);
    if (!routing || routing.cabinetIds.length === 0) {
      this.logger.error(
        `Telegram: нет маршрутизации кабинетов для токена (prefix=${botToken.slice(0, 8)}…) — handlers не зарегистрированы`,
      );
      return;
    }
    this.registerTelegramAccessMiddleware(telegraf, routing);
    this.registerTelegramMainMenuHandlers(telegraf);
    this.registerTelegramDraftActionHandlers(telegraf);
    this.registerTelegramUserbotActionHandlers(telegraf);
    this.registerTelegramMediaHandlers(telegraf);
  }

  private registerTelegramAccessMiddleware(
    telegraf: Telegraf,
    routing: { cabinetIds: string[] },
  ): void {
    telegraf.use(async (ctx, next) => {
      const uid = ctx.from?.id;
      const textPreview =
        ctx.message && 'text' in ctx.message && ctx.message.text
          ? ctx.message.text.slice(0, 120)
          : undefined;
      this.logger.log(
        `TG inbound: updateType=${ctx.updateType} userId=${uid ?? 'none'} chatId=${ctx.chat?.id} text=${textPreview ?? '—'}`,
      );

      if (!uid) {
        this.logger.debug('TG: no ctx.from — пропуск (канал/системное?)');
        return next();
      }
      const candidates = routing.cabinetIds;
      const linkedAuth = await this.prisma.authUser.findFirst({
        where: { telegramUserId: String(uid) },
        select: { id: true },
      });
      const authOk = Boolean(linkedAuth?.id);
      const whitelistByCabinet = await Promise.all(
        candidates.map(async (cid) => ({
          cid,
          whitelist: await this.getWhitelistUserIdsForCabinet(cid),
        })),
      );
      let chosen: string | null = null;
      for (const { cid, whitelist } of whitelistByCabinet) {
        if (whitelist.includes(uid) || authOk) {
          chosen = cid;
          break;
        }
      }
      if (!chosen) {
        this.logger.warn(
          `TG: доступ запрещён userId=${uid} cabinets=${candidates.join(',')}. Проверьте TELEGRAM_WHITELIST в настройках кабинета.`,
        );
        await ctx.reply('Доступ запрещён.');
        return;
      }
      return this.cabinetContext.runWithCabinetAsync(chosen, async () => {
        await next();
      });
    });
  }

  private registerTelegramMainMenuHandlers(telegraf: Telegraf): void {
    telegraf.hears(/^Сводка$/i, async (ctx) => {
      await this.chatMenu.handleMenuSummary(ctx);
    });
    telegraf.hears(/^Рейтинги$/i, async (ctx) => {
      await this.chatMenu.handleMenuRatings(ctx);
    });
    telegraf.hears(/^Сделки$/i, async (ctx) => {
      await this.chatMenu.handleMenuTrades(ctx);
    });
    telegraf.hears(/^Диагностика$/i, async (ctx) => {
      await this.chatMenu.handleMenuDiagnostics(ctx);
    });
    telegraf.hears(/^Логи$/i, async (ctx) => {
      await this.chatMenu.handleMenuLogs(ctx);
    });

    telegraf.action(/^menu_refresh:summary$/, async (ctx) => {
      await ctx.answerCbQuery('Обновляю…');
      const m = ctx.callbackQuery?.message;
      // Пришло не из сообщения (например inline) — просто отправим новую сводку
      if (!m || !('message_id' in m) || !m.chat || typeof m.chat.id !== 'number') {
        await this.chatMenu.handleMenuSummary(ctx);
        return;
      }
      const chatId = m.chat.id;
      const messageId = m.message_id;
      await this.chatMenu.handleMenuSummary(ctx, { edit: { chatId, messageId } });
    });

    telegraf.action(/^ev:(.+)$/i, async (ctx) => {
      const sid = ctx.match?.[1]?.trim();
      if (!sid) {
        await ctx.answerCbQuery();
        return;
      }
      await ctx.answerCbQuery();
      await this.chatMenu.handleSignalEvents(ctx, sid);
    });

    telegraf.action(/^td:(.+)$/i, async (ctx) => {
      const sid = ctx.match?.[1]?.trim();
      if (!sid) {
        await ctx.answerCbQuery();
        return;
      }
      await this.chatMenu.handleTradeDetailCallback(ctx, sid);
    });
  }

  private registerTelegramDraftActionHandlers(telegraf: Telegraf): void {
    telegraf.action('sig_confirm', async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) {
        await ctx.answerCbQuery();
        return;
      }
      const draft = this.conversationState.getActiveDraft(uid);
      if (!draft) {
        await ctx.answerCbQuery('Нет черновика сигнала', { show_alert: true });
        return;
      }
      if (draft.phase !== 'ready' || !draft.signal) {
        await ctx.answerCbQuery(
          'Сначала дополните все поля сигнала ответами в чате',
          { show_alert: true },
        );
        return;
      }
      await ctx.answerCbQuery();
      await this.clearTelegramInlineKeyboard(ctx);
      await this.draftFlow.applySourceToSignal(uid, draft.signal);
      const rawCombined = draft.userTurns.join('\n---\n');
      void this.appLog.append('info', 'telegram', 'Подтверждение: выставление ордеров', {
        userId: uid,
        pair: draft.signal.pair,
        source: draft.signal.source,
      });
      const place = await this.bybit.placeSignalOrders(
        draft.signal,
        rawCombined,
      );
      if (place.ok) {
        this.conversationState.drafts.delete(uid);
        void this.appLog.append('info', 'telegram', 'Ордера выставлены', {
          userId: uid,
          signalId: place.signalId,
          bybitOrderIds: place.bybitOrderIds,
        });
        await ctx.reply(
          `Ордера выставлены. signalId=${place.signalId ?? ''}\n\n` +
            `Контекст диалога сброшен — можно отправить новый сигнал.`,
        );
      } else {
        void this.appLog.append('error', 'telegram', 'Ошибка выставления ордеров', {
          userId: uid,
          error: formatError(place.error),
        });
        await ctx.reply(
          `Не удалось выставить ордера: ${formatError(place.error)}`,
        );
      }
    });

    telegraf.action('sig_cancel', async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) {
        await ctx.answerCbQuery();
        return;
      }
      this.conversationState.drafts.delete(uid);
      await ctx.answerCbQuery('Черновик отменён');
      await this.clearTelegramInlineKeyboard(ctx);
      await ctx.reply('Черновик сигнала отменён.');
    });

    telegraf.action(/^src_pick:(\d+)$/, async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) { await ctx.answerCbQuery(); return; }
      const draft = this.conversationState.getActiveDraft(uid);
      if (draft?.phase !== 'awaiting_source' || !draft.signal) {
        await ctx.answerCbQuery('Нет активного черновика', { show_alert: true });
        return;
      }
      const idx = parseInt(ctx.match?.[1] ?? '', 10);
      const chosen = draft.pendingSources?.[idx];
      if (!chosen) {
        await ctx.answerCbQuery('Неверный индекс источника', { show_alert: true });
        return;
      }
      draft.signal.source = chosen;
      this.conversationState.drafts.set(uid, {
        phase: 'ready',
        signal: draft.signal,
        userTurns: draft.userTurns,
        updatedAtMs: Date.now(),
      });
      await ctx.answerCbQuery(`Источник: ${chosen}`);
      await this.clearTelegramInlineKeyboard(ctx);
      const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
      await ctx.reply(formatSignalTable(draft.signal, defaultOrderUsd), {
        ...confirmKeyboard(),
      });
    });

    telegraf.action('src_none', async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) { await ctx.answerCbQuery(); return; }
      const draft = this.conversationState.getActiveDraft(uid);
      if (draft?.phase !== 'awaiting_source' || !draft.signal) {
        await ctx.answerCbQuery('Нет активного черновика', { show_alert: true });
        return;
      }
      delete draft.signal.source;
      this.conversationState.drafts.set(uid, {
        phase: 'ready',
        signal: draft.signal,
        userTurns: draft.userTurns,
        updatedAtMs: Date.now(),
      });
      await ctx.answerCbQuery('Без источника');
      await this.clearTelegramInlineKeyboard(ctx);
      const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
      await ctx.reply(formatSignalTable(draft.signal, defaultOrderUsd), {
        ...confirmKeyboard(),
      });
    });
  }

  private registerTelegramUserbotActionHandlers(telegraf: Telegraf): void {
    telegraf.action(/^ub_confirm:(.+)$/i, async (ctx) => {
      const uid = ctx.from?.id;
      const requestId = ctx.match?.[1];
      if (!uid || !requestId) {
        await ctx.answerCbQuery();
        return;
      }
      const req = this.conversationState.externalConfirmations.get(requestId);
      const parsed = parseExternalRequestKey(requestId);
      const cabinetId = req?.cabinetId || parsed.cabinetId;
      const ingestId = req?.ingestId || parsed.ingestId;
      await ctx.answerCbQuery('Подтверждаю сигнал...');
      const fallback = await this.cabinetContext.runWithCabinet(cabinetId || null, () =>
        this.draftFlow.confirmFromIngestId(ingestId),
      );
      if (!fallback.ok) {
        await req?.onResult?.({
          decision: 'confirmed',
          ok: false,
          error: fallback.error,
          placeErrorCode: fallback.placeErrorCode,
          actorUserId: uid,
        });
        await ctx.reply(`Подтверждение не выполнено: ${fallback.error}`);
        return;
      }
      this.conversationState.externalConfirmations.delete(requestId);
      await req?.onResult?.({
        decision: 'confirmed',
        ok: true,
        signalId: fallback.signalId,
        bybitOrderIds: fallback.bybitOrderIds,
        actorUserId: uid,
      });
      await ctx.reply(
        `Сигнал подтверждён. Ордера выставлены. signalId=${fallback.signalId ?? ''}`,
      );
    });

    telegraf.action(/^ub_reject:(.+)$/i, async (ctx) => {
      const uid = ctx.from?.id;
      const requestId = ctx.match?.[1];
      if (!uid || !requestId) {
        await ctx.answerCbQuery();
        return;
      }
      const req = this.conversationState.externalConfirmations.get(requestId);
      this.conversationState.externalConfirmations.delete(requestId);
      const parsed = parseExternalRequestKey(requestId);
      const ingestId = req?.ingestId || parsed.ingestId;
      await ctx.answerCbQuery('Сигнал отклонён');
      await req?.onResult?.({
        decision: 'rejected',
        ok: true,
        actorUserId: uid,
      });
      await this.prisma.tgUserbotIngest
        .update({
          where: { id: ingestId },
          data: {
            status: 'cancelled_by_confirmation',
            error: `Отклонено пользователем ${uid}`,
          },
        })
        .catch(() => undefined);
      await ctx.reply('Сигнал отклонён.');
    });

    telegraf.action(/^spot_buy_yes:(.+)$/i, async (ctx) => {
      const requestId = ctx.match?.[1];
      if (!requestId) {
        await ctx.answerCbQuery();
        return;
      }
      await this.spotFlow.handleSpotBuyYes(ctx, requestId);
    });

    telegraf.action(/^spot_buy_no:(.+)$/i, async (ctx) => {
      const requestId = ctx.match?.[1];
      if (!requestId) {
        await ctx.answerCbQuery();
        return;
      }
      await this.spotFlow.handleSpotBuyNo(ctx, requestId);
    });

    telegraf.action(/^spot_sell_yes:([^:]+):(tp|sl):(\d+)$/i, async (ctx) => {
      const signalId = ctx.match?.[1];
      const kind = ctx.match?.[2] as 'tp' | 'sl' | undefined;
      const levelIndex = Number(ctx.match?.[3]);
      if (!signalId || !kind || !Number.isFinite(levelIndex)) {
        await ctx.answerCbQuery();
        return;
      }
      await this.spotFlow.handleSpotSellYes(ctx, signalId, kind, levelIndex);
    });

    telegraf.action(/^spot_sell_no:([^:]+):(tp|sl):(\d+)$/i, async (ctx) => {
      const signalId = ctx.match?.[1];
      const kind = ctx.match?.[2] as 'tp' | 'sl' | undefined;
      const levelIndex = Number(ctx.match?.[3]);
      if (!signalId || !kind || !Number.isFinite(levelIndex)) {
        await ctx.answerCbQuery();
        return;
      }
      await this.spotFlow.handleSpotSellNo(ctx, signalId, kind, levelIndex);
    });

    telegraf.action(/^ub_stale_cancel:(.+)$/i, async (ctx) => {
      const uid = ctx.from?.id;
      const signalId = ctx.match?.[1]?.trim();
      if (!uid || !signalId) {
        await this.safeAnswerCbQuery(ctx);
        return;
      }
      // Сразу отвечаем на callback: иначе при медленном DB/whitelist истекает окно Telegram (~10 с)
      // → 400 «query is too old», необработанное исключение и bot.catch.
      await this.safeAnswerCbQuery(ctx, 'Отменяю ордера…');
      try {
        const row = await this.prisma.signal.findUnique({
          where: { id: signalId },
          select: { id: true, cabinetId: true },
        });
        if (!row) {
          await ctx.reply(`Сигнал не найден: ${signalId}`);
          return;
        }
        const targetCabinetId =
          row.cabinetId?.trim() || (await this.cabinets.getDefaultCabinetId());
        const allowed = await this.cabinetContext.runWithCabinetAsync(
          targetCabinetId,
          () => this.isAllowed(uid),
        );
        if (!allowed) {
          await ctx.reply(
            'Нет доступа к кабинету этой сделки (TELEGRAM_WHITELIST или привязка Telegram к аккаунту).',
          );
          return;
        }
        await this.clearTelegramInlineKeyboard(ctx);
        const closed = await this.cabinetContext.runWithCabinetAsync(
          targetCabinetId,
          () => this.bybit.closeSignalManually(signalId),
        );
        if (closed.ok) {
          void this.appLog.append('info', 'telegram', 'Result без входа: отмена по кнопке', {
            userId: uid,
            signalId,
            cabinetId: targetCabinetId,
            cancelledOrders: closed.cancelledOrders,
            closedPositions: closed.closedPositions,
          });
          await ctx.reply(`Ордера по сделке отменены. signalId=${signalId}`);
        } else {
          const err =
            closed.error ??
            closed.details ??
            'Не удалось отменить ордера на Bybit';
          void this.appLog.append('warn', 'telegram', 'Result без входа: отмена по кнопке не удалась', {
            userId: uid,
            signalId,
            cabinetId: targetCabinetId,
            error: err,
          });
          await ctx.reply(`Не удалось отменить: ${err}`);
        }
      } catch (e) {
        const fe = formatError(e);
        this.logger.warn(`ub_stale_cancel signalId=${signalId}: ${fe}`);
        void this.appLog.append('error', 'telegram', 'ub_stale_cancel: необработанная ошибка', {
          userId: uid,
          signalId,
          error: fe,
        });
        await ctx.reply(`Ошибка: ${fe}`);
      }
    });
  }

  private registerTelegramMediaHandlers(telegraf: Telegraf): void {
    telegraf.on('text', async (ctx) => {
      const text = ctx.message.text?.trim() ?? '';
      const uid = ctx.from?.id;
      if (!uid) return;

      try {
        if (text.startsWith('/')) {
          if (text === '/source' || text.startsWith('/source ')) {
            const rest = text.slice('/source'.length).trim();
            if (!rest) {
              const cur =
                this.conversationState.sourceOverrideByUser.get(uid)?.trim() ??
                (await this.settings.get('SIGNAL_SOURCE'))?.trim() ??
                '';
              await ctx.reply(
                cur
                  ? `Текущий источник: ${cur}`
                  : 'Источник не задан. Укажите в настройках API (SIGNAL_SOURCE) или: /source Binance Killers',
              );
              return;
            }
            if (rest.toLowerCase() === 'off' || rest === '-') {
              this.conversationState.sourceOverrideByUser.delete(uid);
              await ctx.reply(
                'Переопределение источника сброшено (используются настройки API или текст сигнала).',
              );
              return;
            }
            this.conversationState.sourceOverrideByUser.set(uid, rest);
            await ctx.reply(`Источник для следующих сигналов: ${rest}`);
            return;
          }
          const eventsCmd = text.match(/^\/(events|события)\s+(\S+)/i);
          if (eventsCmd?.[2]) {
            await this.chatMenu.handleSignalEvents(ctx, eventsCmd[2]);
            return;
          }
          if (
            text === '/stats' ||
            text === '/сводка' ||
            text === '/balance' ||
            text === '/баланс' ||
            text === '/diag' ||
            text === '/диагностика' ||
            text === '/logs' ||
            text === '/логи' ||
            text === '/help' ||
            text === '/команды'
          ) {
            if (text === '/stats' || text === '/сводка') {
              await this.chatMenu.handleMenuSummary(ctx);
            } else if (text === '/balance' || text === '/баланс') {
              const d = await this.bybit.getUnifiedUsdtBalanceDetails();
              await ctx.reply(
                d !== undefined && Number.isFinite(d.availableUsd)
                  ? `Баланс: ${d.totalUsd.toFixed(2)} USDT\nДоступный баланс: ${d.availableUsd.toFixed(2)} USDT`
                  : 'Баланс недоступен (проверьте ключи Bybit).',
              );
            } else if (text === '/diag' || text === '/диагностика') {
              await this.chatMenu.handleMenuDiagnostics(ctx);
            } else if (text === '/logs' || text === '/логи') {
              await this.chatMenu.handleMenuLogs(ctx);
            } else {
              await ctx.reply(
                [
                  'Команды:',
                  '/menu — показать клавиатуру',
                  '/stats — сводка (статистика)',
                  '/balance — баланс USDT',
                  '/diag — диагностика (userbot, ingest, Bybit)',
                  '/logs — последние записи лога',
                  '/events ID — события по сделке',
                  '/source — источник сигнала',
                  '/cancel — сброс черновика',
                ].join('\n'),
                mainMenuKeyboard(),
              );
            }
            return;
          }
          if (text === '/start') {
            await ctx.reply(
              'Отправьте сигнал текстом, фото или голосом. Если чего-то не хватает — бот задаст вопросы; отвечайте сообщениями, контекст сохраняется до подтверждения.\n' +
                'После полного разбора проверьте таблицу, при необходимости пришлите правки текстом, затем «Подтвердить».\n' +
                'Источник сигнала (канал/приложение, для статистики): задайте в настройках API или командой /source Название.\n' +
                'Статистика и диагностика: кнопки внизу или /stats, /diag, /logs, /events. /help — список команд.\n' +
                'Команды: /cancel — отменить черновик; /menu — меню.',
              mainMenuKeyboard(),
            );
          } else if (text === '/menu') {
            await ctx.reply(
              'Выберите раздел кнопками или /help для списка команд.',
              mainMenuKeyboard(),
            );
          } else if (text === '/cancel') {
            if (this.conversationState.drafts.delete(uid)) {
              await ctx.reply('Черновик отменён.');
            } else {
              await ctx.reply('Нет активного черновика.');
            }
          }
          return;
        }

        const scopedCabinetId = this.currentCabinetId();
        if (!scopedCabinetId) {
          await ctx.reply('Внутренняя ошибка: нет контекста кабинета.');
          return;
        }

        const spotAmount = await this.spotFlow.tryHandleSpotAmountText(uid, text);
        if (spotAmount.handled) {
          await ctx.reply(spotAmount.message);
          return;
        }
        const spotSell = await this.spotFlow.tryHandleSpotSellPercentText(uid, text);
        if (spotSell.handled) {
          await ctx.reply(spotSell.message);
          return;
        }

        if (this.conversationState.drafts.has(uid)) {
          const draft = this.conversationState.getActiveDraft(uid)!;
          if (draft.phase === 'collecting') {
            this.logger.log(`TG text: continue draft userId=${uid}`);
            this.scheduleTelegramHeavyInbound(
              uid,
              scopedCabinetId,
              'text_draft_collect',
              ctx,
              async () => {
                void ctx.sendChatAction('typing').catch(() => undefined);
                const res = await this.transcript.continueSignalDraft(
                  draft.partial ?? {},
                  draft.userTurns,
                  text,
                  await this.draftFlow.buildTelegramTranscriptOverrides(),
                );
                await this.draftFlow.handleParseResult(ctx, res, text);
              },
            );
            return;
          }
          if (draft.phase === 'ready' && draft.signal) {
            const signal = draft.signal;
            this.logger.log(`TG text: correction draft userId=${uid}`);
            this.scheduleTelegramHeavyInbound(
              uid,
              scopedCabinetId,
              'text_draft_correct',
              ctx,
              async () => {
                void ctx.sendChatAction('typing').catch(() => undefined);
                const res = await this.transcript.applyCorrection(
                  signal,
                  text,
                  await this.draftFlow.buildTelegramTranscriptOverrides(),
                );
                await this.draftFlow.handleParseResult(ctx, res, text);
              },
            );
            return;
          }
        }

        this.logger.log(`TG text: new signal parse userId=${uid} (deferred)`);
        this.scheduleTelegramHeavyInbound(
          uid,
          scopedCabinetId,
          'text_new_signal',
          ctx,
          async () => {
            void ctx.sendChatAction('typing').catch(() => undefined);
            const res = await this.transcript.parse(
              'text',
              { text },
              await this.draftFlow.buildTelegramTranscriptOverrides(),
            );
            await this.draftFlow.handleParseResult(ctx, res, text);
          },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`TG text handler: ${msg}`, e instanceof Error ? e.stack : undefined);
        await ctx.reply(`Ошибка бота: ${msg}`);
      }
    });

    telegraf.on('photo', async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) return;
      try {
      const photos = ctx.message.photo;
      const best = photos?.[photos.length - 1];
      if (!best) {
        await ctx.reply('Не удалось получить фото');
        return;
      }
      const link = await ctx.telegram.getFileLink(best.file_id);
      const buf = await fetch(link.href).then((r) => r.arrayBuffer());
      const base64 = Buffer.from(buf).toString('base64');
      const scopedCabinetId = this.currentCabinetId();
      if (!scopedCabinetId) {
        await ctx.reply('Внутренняя ошибка: нет контекста кабинета.');
        return;
      }
      this.logger.log(`TG photo: parse userId=${uid} (deferred)`);
      const draft = this.conversationState.getActiveDraft(uid);
      const continuation =
        draft?.phase === 'collecting' || draft?.phase === 'ready'
          ? {
              continuationContext: {
                partial:
                  draft.phase === 'ready' && draft.signal
                    ? draft.signal
                    : (draft.partial ?? {}),
                userTurns: draft.userTurns,
              },
            }
          : {};
      this.scheduleTelegramHeavyInbound(uid, scopedCabinetId, 'photo_parse', ctx, async () => {
        void ctx.sendChatAction('typing').catch(() => undefined);
        const res = await this.transcript.parse(
          'image',
          {
            imageBase64: base64,
            imageMime: 'image/jpeg',
            ...continuation,
          },
          await this.draftFlow.buildTelegramTranscriptOverrides(),
        );
        await this.draftFlow.handleParseResult(ctx, res, '[photo]');
      });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`TG photo handler: ${msg}`, e instanceof Error ? e.stack : undefined);
        await ctx.reply(`Ошибка: ${msg}`);
      }
    });

    telegraf.on('voice', async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) return;
      const fileId = ctx.message.voice?.file_id;
      if (!fileId) {
        await ctx.reply('Пустое аудио');
        return;
      }
      try {
      const link = await ctx.telegram.getFileLink(fileId);
      const buf = await fetch(link.href).then((r) => r.arrayBuffer());
      const base64 = Buffer.from(buf).toString('base64');
      const scopedCabinetId = this.currentCabinetId();
      if (!scopedCabinetId) {
        await ctx.reply('Внутренняя ошибка: нет контекста кабинета.');
        return;
      }
      this.logger.log(`TG voice: parse userId=${uid} (deferred)`);
      const draft = this.conversationState.getActiveDraft(uid);
      const continuation =
        draft?.phase === 'collecting' || draft?.phase === 'ready'
          ? {
              continuationContext: {
                partial:
                  draft.phase === 'ready' && draft.signal
                    ? draft.signal
                    : (draft.partial ?? {}),
                userTurns: draft.userTurns,
              },
            }
          : {};
      this.scheduleTelegramHeavyInbound(uid, scopedCabinetId, 'voice_parse', ctx, async () => {
        void ctx.sendChatAction('typing').catch(() => undefined);
        const res = await this.transcript.parse(
          'audio',
          {
            audioBase64: base64,
            audioMime: 'audio/ogg',
            ...continuation,
          },
          await this.draftFlow.buildTelegramTranscriptOverrides(),
        );
        await this.draftFlow.handleParseResult(ctx, res, '[voice]');
      });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`TG voice handler: ${msg}`, e instanceof Error ? e.stack : undefined);
        await ctx.reply(`Ошибка: ${msg}`);
      }
    });
  }
}
