import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
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
import { tradeSignalEventTitleRu } from '../utils/telegram-trade-event-titles.util';
import {
  mergeDistinctFiniteNumericIds,
  parseStoredTelegramUserIdAsChatId,
  parseTelegramWhitelistUserIds,
} from '../utils/telegram-whitelist.util';
import type { ExternalConfirmationResult } from '../types/telegram.types';

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private botLaunchRetryTimer: NodeJS.Timeout | null = null;
  private botSyncTimer: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;
  private botSyncInFlight = false;
  private readonly launchedBotTokensByCabinet = new Map<string, string>();

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
  ) {}

  /** Дефолт номинала с учётом DEFAULT_ORDER_USD и процента от equity. */
  private async getResolvedDefaultOrderUsd(): Promise<number> {
    const d = await this.bybit.getUnifiedUsdtBalanceDetails();
    return this.settings.getDefaultOrderUsd(d?.totalUsd);
  }

  async onModuleInit(): Promise<void> {
    // Не блокируем bootstrap API: запуск Telegram-ботов и приветственная рассылка могут зависеть от внешней сети.
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
        'No cabinet has TELEGRAM_BOT_TOKEN in cabinet settings — assistant bots are disabled',
      );
      return;
    }
    await this.sendStartupGreeting();
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
    const cabinets = await this.prisma.cabinet.findMany({
      select: {
        id: true,
        name: true,
        settings: {
          where: { key: 'TELEGRAM_BOT_TOKEN' },
          select: { value: true },
          take: 1,
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const desired = new Map<
      string,
      { token: string; name: string }
    >();
    for (const cabinet of cabinets) {
      const token = String(cabinet.settings[0]?.value ?? '').trim();
      if (!token) continue;
      desired.set(cabinet.id, { token, name: cabinet.name });
    }

    for (const [cabinetId, existingBot] of this.botRegistry.entries()) {
      const wanted = desired.get(cabinetId);
      const launchedToken = this.launchedBotTokensByCabinet.get(cabinetId);
      if (wanted && launchedToken === wanted.token) {
        continue;
      }
      try {
        existingBot.stop('SIGTERM');
      } catch {
        // ignore
      }
      this.botRegistry.removeCabinetBot(cabinetId);
      this.launchedBotTokensByCabinet.delete(cabinetId);
      this.logger.log(`Telegram bot stopped for cabinet=${cabinetId}`);
    }

    for (const [cabinetId, cfg] of desired.entries()) {
      if (this.launchedBotTokensByCabinet.get(cabinetId) === cfg.token) {
        continue;
      }
      const bot = new Telegraf(cfg.token, {
        handlerTimeout: 180_000,
      });
      bot.catch((err, ctx) => {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : undefined;
        this.logger.error(
          `Telegraf unhandled error (cabinet=${cabinetId}): ${msg} updateType=${ctx?.updateType ?? '?'}`,
          stack,
        );
        void ctx
          ?.reply(
            'Произошла ошибка при обработке сообщения. Проверьте логи сервера (TelegramService).',
          )
          .catch((e) =>
            this.logger.warn(`Could not reply with error to user: ${String(e)}`),
          );
      });
      this.registerHandlers(bot, cabinetId);
      try {
        await this.launchCabinetBotWithTimeout(bot, cabinetId, cfg);
      } catch (e) {
        this.logger.error(
          `Telegram bot launch failed for cabinet=${cabinetId}: ${formatError(e)}`,
        );
      }
    }

    const first = this.botRegistry.values().next().value ?? null;
    this.botRegistry.setPrimaryBot(first);
    return this.botRegistry.launchedCount;
    } finally {
      this.botSyncInFlight = false;
    }
  }

  private telegramLaunchTimeoutMs(): number {
    const raw = process.env.TELEGRAM_BOT_LAUNCH_TIMEOUT_MS?.trim();
    const n = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(n)) return 60_000;
    return Math.min(180_000, Math.max(5_000, n));
  }

  private async launchCabinetBotWithTimeout(
    bot: Telegraf,
    cabinetId: string,
    cfg: { token: string; name: string },
  ): Promise<void> {
    const timeoutMs = this.telegramLaunchTimeoutMs();
    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(
            new Error(
              `Telegram launch timeout after ${timeoutMs}ms (cabinet=${cabinetId})`,
            ),
          );
        }, timeoutMs);
      });

      await Promise.race([
        (async () => {
          // На части токенов может быть активный webhook; без удаления Telegram блокирует getUpdates (long polling).
          await bot.telegram.deleteWebhook({ drop_pending_updates: false });
          await bot.launch();
          this.botRegistry.addLaunchedBot(cabinetId, bot);
          this.launchedBotTokensByCabinet.set(cabinetId, cfg.token);
          const me = await bot.telegram.getMe().catch(() => null);
          this.logger.log(
            `Telegram bot started for cabinet=${cabinetId} (${cfg.name}) username=@${me?.username ?? '?'}`,
          );
        })(),
        timeout,
      ]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }

  /** Уведомление пользователей из whitelist при старте (нужен хотя бы один /start от пользователя ранее). */
  private async sendStartupGreeting(): Promise<void> {
    if (this.botRegistry.launchedCount === 0) {
      return;
    }
    const text =
      (await this.settings.get('TELEGRAM_STARTUP_MESSAGE')) ??
      [
        'SignalsBot запущен.',
        'Отправьте сигнал текстом, фото или голосом.',
        'Если данных мало — ответьте на вопросы бота; контекст сохраняется до «Подтвердить».',
        'Команды: /cancel — отменить черновик.',
      ].join('\n');

    for (const [cabinetId, bot] of this.botRegistry.entries()) {
      const ids = await this.resolveCabinetTelegramNotifyRecipientIds(cabinetId);
      if (ids.length === 0) {
        continue;
      }
      try {
        const me = await bot.telegram.getMe();
        this.logger.log(
          `sendStartupGreeting: cabinet=${cabinetId} bot @${me.username ?? '?'} (id=${me.id}), users=${ids.join(', ')}`,
        );
      } catch (e) {
        this.logger.error(
          `sendStartupGreeting: getMe failed cabinet=${cabinetId}: ${e instanceof Error ? e.message : e}`,
        );
        continue;
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
    for (const bot of this.botRegistry.values()) {
      bot.stop('SIGTERM');
    }
    this.launchedBotTokensByCabinet.clear();
    this.botRegistry.clear();
  }

  private getBotForCabinet(cabinetId: string | null): Telegraf | null {
    return this.botRegistry.getBotForCabinet(cabinetId);
  }

  private async getBotForTelegramUserId(telegramUserIdRaw: string): Promise<Telegraf | null> {
    const telegramUserId = String(telegramUserIdRaw ?? '').trim();
    if (!telegramUserId) return this.botRegistry.getPrimaryBot();
    const authUser = await this.prisma.authUser.findFirst({
      where: { telegramUserId },
      select: { id: true },
    });
    if (!authUser?.id) return this.botRegistry.getPrimaryBot();
    const cabinet = await this.prisma.cabinet.findFirst({
      where: { ownerUserId: authUser.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!cabinet?.id) return this.botRegistry.getPrimaryBot();
    return this.getBotForCabinet(cabinet.id);
  }

  async sendPasswordResetCode(params: {
    telegramUserId: string;
    login: string;
    code: string;
    expiresInMinutes: number;
  }): Promise<{ ok: boolean; error?: string }> {
    const bot = await this.getBotForTelegramUserId(params.telegramUserId);
    if (!bot) {
      return { ok: false, error: 'Telegram bot не запущен' };
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
    const bot = this.getBotForCabinet(this.currentCabinetId());
    if (!bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
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
    const cabinetId =
      this.cabinetContext.getCabinetId() ?? (await this.cabinets.getDefaultCabinetId());
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
        this.logger.warn(`requestExternalSignalConfirmation -> ${uid}: ${formatError(e)}`);
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
    const cabinetLabel = await this.resolveCabinetDisplayLabel();
    const msg =
      this.cabinetNotifyPlainPrefix(cabinetLabel) +
      formatUserbotSignalFailureMessage(params);

    const bot = this.getBotForCabinet(this.currentCabinetId());
    if (!bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
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
        this.logger.warn(`notifyUserbotSignalFailure -> ${uid}: ${formatError(e)}`);
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
    const bot = this.getBotForCabinet(this.currentCabinetId());
    if (!bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
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
        this.logger.warn(`notifyUserbotResultWithoutEntry -> ${uid}: ${formatError(e)}`);
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
    const bot = this.getBotForCabinet(this.currentCabinetId());
    if (!bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
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
        this.logger.warn(`notifyApiTradeCancelled -> ${uid}: ${formatError(e)}`);
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
    const bot = this.getBotForCabinet(this.currentCabinetId());
    if (!bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
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
        this.logger.warn(`notifyApiTradeLiquidation -> ${uid}: ${formatError(e)}`);
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

    return await this.cabinetContext.runWithCabinet(effectiveCabinetId, async () => {
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

      const bot = this.getBotForCabinet(this.currentCabinetId());
      if (!bot) {
        return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
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
          this.logger.warn(`notifyHedgeOppositePlacementAudit -> ${uid}: ${formatError(e)}`);
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

    await this.cabinetContext.runWithCabinet(effectiveCabinetId, async () => {
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

      const bot = this.getBotForCabinet(this.currentCabinetId());
      if (!bot) {
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
          this.logger.warn(`notifyTradeSignalEvent -> ${uid}: ${formatError(e)}`);
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

  private registerHandlers(telegraf: Telegraf, cabinetId: string): void {
    if (!telegraf) return;
    this.registerTelegramAccessMiddleware(telegraf, cabinetId);
    this.registerTelegramMainMenuHandlers(telegraf);
    this.registerTelegramDraftActionHandlers(telegraf);
    this.registerTelegramUserbotActionHandlers(telegraf);
    this.registerTelegramMediaHandlers(telegraf);
  }

  private registerTelegramAccessMiddleware(
    telegraf: Telegraf,
    cabinetId: string,
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
      const allowed = await this.cabinetContext.runWithCabinet(cabinetId, () =>
        this.isAllowed(uid),
      );
      if (!allowed) {
        this.logger.warn(
          `TG: доступ запрещён userId=${uid} cabinet=${cabinetId}. Проверьте TELEGRAM_WHITELIST в настройках кабинета.`,
        );
        await ctx.reply('Доступ запрещён.');
        return;
      }
      return this.cabinetContext.runWithCabinet(cabinetId, () => next());
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

    telegraf.action(/^ub_stale_cancel:(.+)$/i, async (ctx) => {
      const uid = ctx.from?.id;
      const signalId = ctx.match?.[1]?.trim();
      if (!uid || !signalId) {
        await ctx.answerCbQuery();
        return;
      }
      await ctx.answerCbQuery('Отменяю ордера…');
      await this.clearTelegramInlineKeyboard(ctx);
      try {
        const closed = await this.bybit.closeSignalManually(signalId);
        if (closed.ok) {
          void this.appLog.append('info', 'telegram', 'Result без входа: отмена по кнопке', {
            userId: uid,
            signalId,
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
            error: err,
          });
          await ctx.reply(`Не удалось отменить: ${err}`);
        }
      } catch (e) {
        this.logger.warn(`ub_stale_cancel signalId=${signalId}: ${formatError(e)}`);
        await ctx.reply(`Ошибка: ${formatError(e)}`);
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

        if (this.conversationState.drafts.has(uid)) {
          const draft = this.conversationState.getActiveDraft(uid)!;
          if (draft.phase === 'collecting') {
            this.logger.log(`TG text: continue draft userId=${uid}`);
            const res = await this.transcript.continueSignalDraft(
              draft.partial ?? {},
              draft.userTurns,
              text,
              await this.draftFlow.buildTelegramTranscriptOverrides(),
            );
            await this.draftFlow.handleParseResult(ctx, res, text);
            return;
          }
          if (draft.phase === 'ready' && draft.signal) {
            this.logger.log(`TG text: correction draft userId=${uid}`);
            const res = await this.transcript.applyCorrection(
              draft.signal,
              text,
              await this.draftFlow.buildTelegramTranscriptOverrides(),
            );
            await this.draftFlow.handleParseResult(ctx, res, text);
            return;
          }
        }

        this.logger.log(`TG text: new signal parse userId=${uid}`);
        const res = await this.transcript.parse(
          'text',
          { text },
          await this.draftFlow.buildTelegramTranscriptOverrides(),
        );
        await this.draftFlow.handleParseResult(ctx, res, text);
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
      this.logger.log(`TG photo: parse userId=${uid}`);
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
      this.logger.log(`TG voice: parse userId=${uid}`);
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
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`TG voice handler: ${msg}`, e instanceof Error ? e.stack : undefined);
        await ctx.reply(`Ошибка: ${msg}`);
      }
    });
  }
}
