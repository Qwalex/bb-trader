import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Context, Markup, Telegraf } from 'telegraf';

import type { SignalDto } from '@repo/shared';

import type { Order, Signal } from '@prisma/client';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { BybitService } from '../bybit/bybit.service';
import { OrdersService } from '../orders/orders.service';
import { SettingsService } from '../settings/settings.service';
import {
  mergePartialSignals,
  sanitizeSignalSource,
} from '../transcript/partial-signal.util';
import { TranscriptService } from '../transcript/transcript.service';

type DraftPhase = 'collecting' | 'ready' | 'awaiting_source';

type DraftSession = {
  phase: DraftPhase;
  /** Сообщения пользователя с начала сессии (контекст до подтверждения). */
  userTurns: string[];
  /** Готовый сигнал после полного разбора. */
  signal?: SignalDto;
  /** Накопленные поля, пока не хватает данных. */
  partial?: Partial<SignalDto>;
  /** Существующие источники для выбора (фаза awaiting_source). */
  pendingSources?: string[];
};

type ExternalConfirmationResult = {
  decision: 'confirmed' | 'rejected';
  ok: boolean;
  error?: string;
  signalId?: string;
  bybitOrderIds?: string[];
  actorUserId?: number;
};

type ExternalConfirmationRequest = {
  ingestId: string;
  signal: SignalDto;
  rawMessage?: string;
  createdAt: number;
  onResult?: (result: ExternalConfirmationResult) => Promise<void> | void;
};

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private bot: Telegraf | null = null;
  /** Один черновик сигнала на пользователя (до подтверждения или отмены). */
  private readonly drafts = new Map<number, DraftSession>();
  /** Переопределение «канал/приложение» для сигналов (важнее настройки SIGNAL_SOURCE). */
  private readonly sourceOverrideByUser = new Map<number, string>();
  /** Подтверждения сигналов, пришедших из userbot (группы), ключ = ingestId. */
  private readonly externalConfirmations = new Map<string, ExternalConfirmationRequest>();

  constructor(
    private readonly settings: SettingsService,
    private readonly transcript: TranscriptService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly prisma: PrismaService,
  ) {}

  /** Дефолт номинала с учётом DEFAULT_ORDER_USD и процента от equity. */
  private async getResolvedDefaultOrderUsd(): Promise<number> {
    const d = await this.bybit.getUnifiedUsdtBalanceDetails();
    return this.settings.getDefaultOrderUsd(d?.totalUsd);
  }

  async onModuleInit(): Promise<void> {
    const token = await this.settings.get('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn('TELEGRAM_BOT_TOKEN not set — Telegram bot disabled');
      return;
    }
    /** OpenRouter до 180s; иначе Telegraf обрывал обработчик на 90s — «тишина» в чате. */
    this.bot = new Telegraf(token, {
      handlerTimeout: 180_000,
    });

    this.bot.catch((err, ctx) => {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `Telegraf unhandled error: ${msg} updateType=${ctx?.updateType ?? '?'}`,
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

    this.registerHandlers();
    void this.bot.launch().then(async () => {
      this.logger.log(
        'Telegram bot started (long polling, handlerTimeout=180s)',
      );
      await this.sendStartupGreeting();
    });
  }

  /** Уведомление пользователей из whitelist при старте (нужен хотя бы один /start от пользователя ранее). */
  private async sendStartupGreeting(): Promise<void> {
    if (!this.bot) {
      return;
    }

    const raw =
      (await this.settings.get('TELEGRAM_WHITELIST')) ??
      process.env.TELEGRAM_WHITELIST;

    this.logger.log(
      `sendStartupGreeting: whitelist loaded=${Boolean(raw?.trim())} (length=${raw?.trim()?.length ?? 0})`,
    );

    if (!raw?.trim()) {
      this.logger.warn(
        'Приветствие не отправлено: TELEGRAM_WHITELIST пустой или не загружен из .env. Проверьте файл env при запуске из apps/api — должен подхватываться корень монорепо.',
      );
      return;
    }

    const text =
      (await this.settings.get('TELEGRAM_STARTUP_MESSAGE')) ??
      process.env.TELEGRAM_STARTUP_MESSAGE ??
      [
        'SignalsBot запущен.',
        'Отправьте сигнал текстом, фото или голосом.',
        'Если данных мало — ответьте на вопросы бота; контекст сохраняется до «Подтвердить».',
        'Команды: /cancel — отменить черновик.',
      ].join('\n');

    const ids = raw
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !Number.isNaN(n));

    if (ids.length === 0) {
      this.logger.warn(
        `TELEGRAM_WHITELIST не удалось разобрать в числовые id (raw="${raw.slice(0, 80)}"). Пример: 123456789 или 111,222`,
      );
      return;
    }

    try {
      const me = await this.bot.telegram.getMe();
      this.logger.log(
        `sendStartupGreeting: bot @${me.username ?? '?'} (id=${me.id}), отправка в ${ids.length} чат(ов): ${ids.join(', ')}`,
      );
    } catch (e) {
      this.logger.error(
        `sendStartupGreeting: getMe failed — токен бота неверен? ${e instanceof Error ? e.message : e}`,
      );
      return;
    }

    await new Promise((r) => setTimeout(r, 1500));

    for (const id of ids) {
      try {
        await this.bot.telegram.sendMessage(id, text);
        this.logger.log(`Приветствие доставлено в chat_id=${id}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(
          `Приветствие НЕ доставлено в chat_id=${id}: ${msg}. Часто: пользователь не нажимал /start у этого бота, заблокировал бота, или id не тот (нужен ваш user id в личке с ботом).`,
        );
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.bot?.stop('SIGTERM');
  }

  /**
   * Итоговый источник сигнала: /source у пользователя → SIGNAL_SOURCE в настройках → из текста (если модель извлекла название канала).
   */
  private async resolveSourceForUser(
    userId: number,
    llmSource: string | undefined,
  ): Promise<string | undefined> {
    const o = this.sourceOverrideByUser.get(userId)?.trim();
    if (o) return o;
    const fromSettings = (await this.settings.get('SIGNAL_SOURCE'))?.trim();
    if (fromSettings) return fromSettings;
    return sanitizeSignalSource(llmSource);
  }

  private async applySourceToSignal(
    userId: number,
    signal: SignalDto,
  ): Promise<void> {
    const resolved = await this.resolveSourceForUser(userId, signal.source);
    if (resolved) {
      signal.source = resolved;
    } else {
      delete signal.source;
    }
  }

  private async isAllowed(userId: number): Promise<boolean> {
    const ids = await this.getWhitelistUserIds();
    return ids.includes(userId);
  }

  private async getWhitelistUserIds(): Promise<number[]> {
    const raw =
      (await this.settings.get('TELEGRAM_WHITELIST')) ??
      process.env.TELEGRAM_WHITELIST;
    if (!raw?.trim()) {
      return [];
    }
    return raw
      .split(/[,\s]+/)
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n));
  }

  private formatSignalTable(s: SignalDto, defaultOrderUsd: number): string {
    const src = s.source ? `\nИсточник: ${s.source}` : '';
    const sizing =
      s.orderUsd > 0
        ? `Сумма: $${s.orderUsd} USDT (номинал)`
        : s.capitalPercent > 0
          ? `Капитал: ${s.capitalPercent}% от депозита (номинал с плечом)`
          : `Сумма: $${defaultOrderUsd} USDT (по умолчанию)`;
    const tpExtra =
      s.takeProfits.length > 1
        ? `\n(несколько TP: объём позиции делится поровну между уровнями — при 4 TP по 25% каждый)`
        : '';
    return (
      `Сигнал (проверьте данные):\n` +
      `Пара: ${s.pair}\n` +
      `Сторона: ${s.direction.toUpperCase()}\n` +
      `Входы: ${s.entries.join(', ')}\n` +
      `SL: ${s.stopLoss}\n` +
      `TP: ${s.takeProfits.join(', ')}${tpExtra}\n` +
      `Плечо: ${s.leverage}x\n` +
      `${sizing}${src}\n\n` +
      `Отправьте текст с правками или нажмите «Подтвердить».`
    );
  }

  /** Кратко показать, что уже известно в черновике. */
  private formatPartialPreview(p: Partial<SignalDto>): string {
    const lines: string[] = ['Черновик (что уже есть):'];
    if (p.pair) lines.push(`Пара: ${p.pair}`);
    if (p.direction) lines.push(`Сторона: ${p.direction.toUpperCase()}`);
    if (p.entries?.length) lines.push(`Входы: ${p.entries.join(', ')}`);
    if (p.stopLoss !== undefined) lines.push(`SL: ${p.stopLoss}`);
    if (p.takeProfits?.length) lines.push(`TP: ${p.takeProfits.join(', ')}`);
    if (p.leverage !== undefined) lines.push(`Плечо: ${p.leverage}x`);
    if (p.orderUsd !== undefined && p.orderUsd > 0) {
      lines.push(`Сумма: $${p.orderUsd} USDT`);
    }
    if (p.capitalPercent !== undefined && p.capitalPercent > 0) {
      lines.push(`Капитал: ${p.capitalPercent}%`);
    }
    if (p.source) lines.push(`Источник: ${p.source}`);
    if (lines.length === 1) lines.push('(пока мало данных)');
    return lines.join('\n');
  }

  private confirmKeyboard() {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Подтвердить', 'sig_confirm'),
        Markup.button.callback('❌ Отмена', 'sig_cancel'),
      ],
    ]);
  }

  private cancelOnlyKeyboard() {
    return Markup.inlineKeyboard([
      [Markup.button.callback('❌ Отмена', 'sig_cancel')],
    ]);
  }

  private externalConfirmKeyboard(ingestId: string) {
    return Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Подтвердить', `ub_confirm:${ingestId}`),
        Markup.button.callback('❌ Отклонить', `ub_reject:${ingestId}`),
      ],
    ]);
  }

  /** Кнопка отмены ордеров по сделке из уведомления «result без входа». */
  private staleResultCancelKeyboard(signalId: string) {
    return Markup.inlineKeyboard([
      [Markup.button.callback('Отменить', `ub_stale_cancel:${signalId}`)],
    ]);
  }

  private sourceSelectionKeyboard(sources: string[]) {
    const rows = sources.map((s, i) => [
      Markup.button.callback(s, `src_pick:${i}`),
    ]);
    rows.push([Markup.button.callback('➡️ Без источника', 'src_none')]);
    rows.push([Markup.button.callback('❌ Отмена', 'sig_cancel')]);
    return Markup.inlineKeyboard(rows);
  }

  private async getDistinctSources(): Promise<string[]> {
    const rows = await this.prisma.signal.findMany({
      where: { source: { not: null } },
      select: { source: true },
      distinct: ['source'],
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => r.source!).filter(Boolean);
  }

  private formatExternalSignalTable(s: SignalDto, defaultOrderUsd: number): string {
    const src = s.source ? `\nИсточник: ${s.source}` : '';
    const sizing =
      s.orderUsd > 0
        ? `Сумма: $${s.orderUsd} USDT (номинал)`
        : s.capitalPercent > 0
          ? `Капитал: ${s.capitalPercent}% от депозита`
          : `Сумма: $${defaultOrderUsd} USDT (по умолчанию)`;
    return (
      `Новый сигнал из Telegram Userbot\n` +
      `Пара: ${s.pair}\n` +
      `Сторона: ${s.direction.toUpperCase()}\n` +
      `Входы: ${s.entries.join(', ')}\n` +
      `SL: ${s.stopLoss}\n` +
      `TP: ${s.takeProfits.join(', ')}\n` +
      `Плечо: ${s.leverage}x\n` +
      `${sizing}${src}\n\n` +
      `Подтвердите или отклоните сигнал.`
    );
  }

  async requestExternalSignalConfirmation(params: {
    ingestId: string;
    signal: SignalDto;
    rawMessage?: string;
    onResult?: (result: ExternalConfirmationResult) => Promise<void> | void;
  }): Promise<{ ok: boolean; requestId?: string; deliveredTo: number; error?: string }> {
    if (!this.bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
    }
    const ids = await this.getWhitelistUserIds();
    if (ids.length === 0) {
      return { ok: false, deliveredTo: 0, error: 'TELEGRAM_WHITELIST пуст' };
    }
    const requestId = params.ingestId;
    this.externalConfirmations.set(requestId, {
      ingestId: requestId,
      signal: params.signal,
      rawMessage: params.rawMessage,
      createdAt: Date.now(),
      onResult: params.onResult,
    });

    let deliveredTo = 0;
    const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
    const msg = this.formatExternalSignalTable(params.signal, defaultOrderUsd);
    for (const uid of ids) {
      try {
        await this.bot.telegram.sendMessage(
          uid,
          msg,
          this.externalConfirmKeyboard(requestId),
        );
        deliveredTo += 1;
      } catch (e) {
        this.logger.warn(`requestExternalSignalConfirmation -> ${uid}: ${formatError(e)}`);
      }
    }
    if (deliveredTo === 0) {
      this.externalConfirmations.delete(requestId);
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
    stage: 'transcript' | 'bybit';
    error: string;
    missingData?: string[];
  }): Promise<{ ok: boolean; deliveredTo: number; error?: string }> {
    if (!this.bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
    }
    const ids = await this.getWhitelistUserIds();
    if (ids.length === 0) {
      return { ok: false, deliveredTo: 0, error: 'TELEGRAM_WHITELIST пуст' };
    }

    const stageText =
      params.stage === 'transcript' ? 'транскрибации/разбора' : 'установки ордеров на Bybit';
    const missing =
      params.missingData && params.missingData.length > 0
        ? `\nНе хватило данных: ${params.missingData.join(', ')}`
        : '';
    const sourceLine =
      params.groupTitle && params.groupTitle.trim().length > 0
        ? `Группа / канал: ${params.groupTitle.trim()}\n`
        : `Источник (chatId): ${params.chatId}\n`;
    const msg =
      `Ошибка обработки сигнала из группы\n` +
      sourceLine +
      `Токен: ${params.token}\n` +
      `Этап: ${stageText}\n` +
      `Причина: ${params.error}${missing}\n\n` +
      `ingestId: ${params.ingestId}`;

    let deliveredTo = 0;
    for (const uid of ids) {
      try {
        await this.bot.telegram.sendMessage(uid, msg);
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
    if (!this.bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
    }
    const ids = await this.getWhitelistUserIds();
    if (ids.length === 0) {
      return { ok: false, deliveredTo: 0, error: 'TELEGRAM_WHITELIST пуст' };
    }
    const escHtml = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const pair = escHtml((params.pair ?? '').trim().toUpperCase());
    const sourceLine =
      params.groupTitle && params.groupTitle.trim().length > 0
        ? `Группа / канал: ${escHtml(params.groupTitle.trim())}\n`
        : `Источник (chatId): ${escHtml(String(params.chatId))}\n`;
    const resultBody = (params.resultMessageText ?? '').trim() || '—';
    const quoteBody = (params.quotedSnippet ?? '').trim();
    const quoteBlock =
      quoteBody.length > 0
        ? `\n\nЦитата из группы:\n<pre>${escHtml(quoteBody)}</pre>\n`
        : '\n';
    const msg =
      `Возможно ваш ордер для монеты <b>${pair}</b> не актуален\n` +
      sourceLine +
      `\nПолучен результат:\n<pre>${escHtml(resultBody)}</pre>` +
      quoteBlock +
      `\nА вход так и не был осуществлен по сделке (<code>${escHtml(params.signalId)}</code>)\n\n` +
      `ingestId: <code>${escHtml(params.ingestId)}</code>`;

    let deliveredTo = 0;
    for (const uid of ids) {
      try {
        await this.bot.telegram.sendMessage(uid, msg, {
          parse_mode: 'HTML',
          ...this.staleResultCancelKeyboard(params.signalId),
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
    if (!this.bot) {
      return { ok: false, deliveredTo: 0, error: 'Telegram bot не запущен' };
    }
    const ids = await this.getWhitelistUserIds();
    if (ids.length === 0) {
      return { ok: false, deliveredTo: 0, error: 'TELEGRAM_WHITELIST пуст' };
    }
    const escHtml = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const pair = escHtml((params.pair ?? '').trim().toUpperCase());
    const signalId = escHtml((params.signalId ?? '').trim());
    const direction = escHtml((params.direction ?? '').trim().toUpperCase());
    const entries = escHtml(
      params.entries.length > 0 ? params.entries.map((v) => String(v)).join(', ') : '—',
    );
    const stopLoss = escHtml(String(params.stopLoss));
    const takeProfits = escHtml(
      params.takeProfits.length > 0
        ? params.takeProfits.map((v) => String(v)).join(', ')
        : '—',
    );
    const leverage = escHtml(`${params.leverage}x`);
    const size =
      params.capitalPercent > 0
        ? escHtml(`${params.capitalPercent}% от депозита`)
        : escHtml(`$${params.orderUsd} USDT`);
    const source = params.source ? escHtml(params.source) : '—';
    const reasonLine = params.reason
      ? `\nПричина: ${escHtml(params.reason)}`
      : '';
    const msg =
      `<b>Сделка отменена</b>\n` +
      `Пара: <code>${pair}</code>\n` +
      `ID сделки: <code>${signalId}</code>\n` +
      `Направление: <code>${direction}</code>\n` +
      `Входы: <code>${entries}</code>\n` +
      `Stop Loss: <code>${stopLoss}</code>\n` +
      `Take Profit: <code>${takeProfits}</code>\n` +
      `Плечо: <code>${leverage}</code>\n` +
      `Размер: <code>${size}</code>\n` +
      `Источник: <code>${source}</code>${reasonLine}`;

    let deliveredTo = 0;
    for (const uid of ids) {
      try {
        await this.bot.telegram.sendMessage(uid, msg, { parse_mode: 'HTML' });
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

  private tgEsc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private mainMenuKeyboard() {
    // resize — компактнее; пустая зона под клавиатурой задаётся клиентом Telegram, убрать полностью нельзя
    return Markup.keyboard([
      ['Сводка', 'Рейтинги', 'Сделки'],
      ['Диагностика', 'Логи'],
    ])
      .resize()
      .persistent();
  }

  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private todayDateKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private async getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.settings.get(key);
    if (raw == null || raw.trim() === '') {
      return fallback;
    }
    return raw.trim().toLowerCase() === 'true';
  }

  private splitTelegramHtml(text: string, max = 3900): string[] {
    const t = text.trim();
    if (t.length === 0) {
      return [];
    }
    if (t.length <= max) {
      return [t];
    }
    const parts: string[] = [];
    let rest = t;
    while (rest.length > max) {
      const slice = rest.slice(0, max);
      const lastBreak = slice.lastIndexOf('\n');
      const cut = lastBreak > max * 0.4 ? lastBreak : max;
      parts.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    if (rest.length) {
      parts.push(rest);
    }
    return parts;
  }

  private formatRuDate(d: Date): string {
    return new Date(d).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private tradeCanCancelFromTelegram(status: string): boolean {
    return (
      status === 'ORDERS_PLACED' ||
      status === 'OPEN' ||
      status === 'PARSED'
    );
  }

  private async replyHtmlChunks(ctx: Context, html: string): Promise<void> {
    const parts = this.splitTelegramHtml(html);
    for (const part of parts) {
      await ctx.reply(part, { parse_mode: 'HTML' });
    }
  }

  private async handleMenuSummary(ctx: Context): Promise<void> {
    const details = await this.bybit.getUnifiedUsdtBalanceDetails();
    const balStr =
      details !== undefined && Number.isFinite(details.availableUsd)
        ? `баланс ${details.totalUsd.toFixed(2)} · доступный баланс ${details.availableUsd.toFixed(2)} USDT`
        : '—';
    const stats = await this.orders.getDashboardStats();
    const pnlDay = await this.orders.getPnlSeries('day');
    const todayKey = this.todayDateKey();
    const todayRow = pnlDay.find((p) => p.date === todayKey);
    const todayPnlStr =
      todayRow !== undefined ? todayRow.pnl.toFixed(2) : '—';
    const top = await this.orders.getTopSources({ limit: 5 });
    const best = top.bestWinrate;
    const worst = top.worstWinrate;
    let lines =
      `<b>📊 Сводка</b>\n` +
      `<i>Как на дашборде · все источники</i>\n\n` +
      `<b>💵 USDT</b> (Bybit)\n<code>${this.tgEsc(balStr)}</code>\n\n` +
      `<b>📅 PnL за сегодня</b> (закрытые)\n<code>${this.tgEsc(todayPnlStr)}</code>\n\n` +
      `<b>📈 Winrate</b>\n<code>${stats.winrate.toFixed(1)}%</code>\n\n` +
      `<b>Σ PnL всего</b>\n<code>${stats.totalPnl.toFixed(2)}</code>\n\n` +
      `<b>Закрыто</b> · ${stats.totalClosed} <i>(W ${stats.wins} / L ${stats.losses})</i>\n` +
      `<b>Открытые сигналы</b> · ${stats.openSignals}\n`;
    if (best) {
      lines +=
        `\n────────────\n<b>▲ Лучший WR</b> по источнику\n` +
        `<code>${this.tgEsc(best.source ?? '—')}</code>\n` +
        `<b>${best.winrate.toFixed(1)}%</b> · W/L ${best.wL}`;
    }
    if (worst) {
      lines +=
        `\n────────────\n<b>▼ Худший WR</b> по источнику\n` +
        `<code>${this.tgEsc(worst.source ?? '—')}</code>\n` +
        `<b>${worst.winrate.toFixed(1)}%</b> · W/L ${worst.wL}`;
    }
    const parts = this.splitTelegramHtml(lines);
    const refreshKb = Markup.inlineKeyboard([
      [Markup.button.callback('Обновить сводку', 'menu_refresh:summary')],
    ]);
    for (let i = 0; i < parts.length; i++) {
      const chunk = parts[i];
      if (chunk === undefined) {
        continue;
      }
      const isFirst = i === 0;
      await ctx.reply(chunk, {
        parse_mode: 'HTML',
        ...(isFirst ? refreshKb : {}),
      });
    }
  }

  private formatRatingSection(
    emoji: string,
    title: string,
    rows: Awaited<ReturnType<OrdersService['getTopSources']>>['byPnl'],
  ): string {
    if (rows.length === 0) {
      return `<b>${emoji} ${this.tgEsc(title)}</b>\n<i>нет данных</i>`;
    }
    const blocks = rows.map((r, i) => {
      const src = this.tgEsc(r.source ?? '—');
      return (
        `<b>${i + 1}.</b> <code>${src}</code>\n` +
        `├ PnL <b>${r.totalPnl.toFixed(2)}</b> · WR <b>${r.winrate.toFixed(1)}%</b>\n` +
        `└ W/L ${r.wL} · закр. ${r.totalClosed} · откр. ${r.openSignals}`
      );
    });
    return `<b>${emoji} ${this.tgEsc(title)}</b>\n\n` + blocks.join('\n\n');
  }

  private async handleMenuRatings(ctx: Context): Promise<void> {
    const top = await this.orders.getTopSources({ limit: 5 });
    await ctx.reply(
      '<b>⭐ Рейтинги</b>\n<i>Топ-5 в каждом блоке · ниже — по одному сообщению на блок</i>',
      { parse_mode: 'HTML' },
    );
    const blocks: [string, string, Awaited<ReturnType<OrdersService['getTopSources']>>['byPnl']][] = [
      ['💰', 'Топ по PnL', top.byPnl],
      ['📈', 'Топ по Winrate', top.byWinrate],
      ['📉', 'Худший PnL', top.byWorstPnl],
      ['⚠️', 'Худший Winrate', top.byWorstWinrate],
    ];
    for (const [emoji, title, rows] of blocks) {
      await ctx.reply(this.formatRatingSection(emoji, title, rows), {
        parse_mode: 'HTML',
      });
    }
  }

  private async handleMenuDiagnostics(ctx: Context): Promise<void> {
    const [
      userbotEnabled,
      apiId,
      apiHash,
      session,
      chatsTotal,
      chatsEnabled,
      minBalRaw,
    ] = await Promise.all([
      this.getBoolSetting('TELEGRAM_USERBOT_ENABLED', false),
      this.settings.get('TELEGRAM_USERBOT_API_ID'),
      this.settings.get('TELEGRAM_USERBOT_API_HASH'),
      this.settings.get('TELEGRAM_USERBOT_SESSION'),
      this.prisma.tgUserbotChat.count(),
      this.prisma.tgUserbotChat.count({ where: { enabled: true } }),
      this.settings.get('TELEGRAM_USERBOT_MIN_BALANCE_USD'),
    ]);
    const start = this.startOfToday();
    const [ingestTotal, ingestSignal, ingestPlaced, parseIncomplete, parseError] =
      await Promise.all([
        this.prisma.tgUserbotIngest.count({ where: { createdAt: { gte: start } } }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, classification: 'signal' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'placed' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'parse_incomplete' },
        }),
        this.prisma.tgUserbotIngest.count({
          where: { createdAt: { gte: start }, status: 'parse_error' },
        }),
      ]);
    const details = await this.bybit.getUnifiedUsdtBalanceDetails();
    const balance = details?.availableUsd;
    const totalBal = details?.totalUsd;
    const minBal = Number(minBalRaw ?? '3');
    const paused =
      balance !== undefined &&
      Number.isFinite(balance) &&
      Number.isFinite(minBal) &&
      balance < minBal;
    let live: { bybitConnected: boolean; items: unknown[] };
    try {
      live = await this.bybit.getLiveExposureSnapshot();
    } catch {
      live = { bybitConnected: false, items: [] };
    }
    const openDb = await this.prisma.signal.count({
      where: {
        deletedAt: null,
        status: { in: ['ORDERS_PLACED', 'OPEN', 'PARSED'] },
      },
    });
    const html =
      `<b>🔧 Диагностика</b>\n` +
      `<i>Снимок состояния API / userbot / биржи</i>\n\n` +
      `<b>Userbot</b>\n` +
      `├ Включён: <b>${userbotEnabled ? 'да' : 'нет'}</b>\n` +
      `├ Креды: API ID ${apiId?.trim() ? '✓' : '✗'} · Hash ${apiHash?.trim() ? '✓' : '✗'} · сессия ${session?.trim() ? '✓' : '✗'}\n` +
      `└ Чаты: <b>${chatsEnabled}</b> вкл. / <b>${chatsTotal}</b> всего\n\n` +
      `<b>Ingest за сегодня</b>\n` +
      `├ Всего сообщений: <b>${ingestTotal}</b>\n` +
      `├ Класс «сигнал»: <b>${ingestSignal}</b> · placed: <b>${ingestPlaced}</b>\n` +
      `└ parse_incomplete: <b>${parseIncomplete}</b> · parse_error: <b>${parseError}</b>\n\n` +
      `<b>Баланс USDT</b>\n` +
      `├ Баланс: <code>${totalBal !== undefined ? totalBal.toFixed(2) : '—'}</code>\n` +
      `├ Доступный баланс: <code>${balance !== undefined ? balance.toFixed(2) : '—'}</code>\n` +
      `├ Порог: <code>${Number.isFinite(minBal) ? minBal.toFixed(2) : '—'}</code>\n` +
      `└ Пауза автоторговли: <b>${paused ? 'да' : 'нет'}</b>\n\n` +
      `<b>Bybit</b>\n` +
      `├ Ключи: <b>${live.bybitConnected ? 'подключены' : 'нет'}</b>\n` +
      `├ Открытых сигналов в БД: <b>${openDb}</b>\n` +
      `└ С экспозицией на бирже: <b>${live.items.length}</b>`;
    await this.replyHtmlChunks(ctx, html);
  }

  private async handleMenuLogs(ctx: Context): Promise<void> {
    const rows = await this.appLog.list({ limit: 12, category: 'all' });
    if (rows.length === 0) {
      await ctx.reply('В логе пока нет записей.');
      return;
    }
    const blocks = rows.map((r) => {
      const msg = r.message.replace(/\s+/g, ' ').slice(0, 320);
      const when = new Date(r.createdAt).toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      return (
        `<code>${this.tgEsc(r.level)}</code> · <code>${this.tgEsc(r.category)}</code>\n` +
        `<i>${this.tgEsc(when)}</i>\n` +
        `${this.tgEsc(msg)}`
      );
    });
    const body =
      `<b>📋 Журнал</b> · записей: <b>${rows.length}</b>\n` +
      `<i>Сначала новее</i>\n\n` +
      blocks.join('\n\n────────────\n\n');
    await this.replyHtmlChunks(ctx, body);
  }

  private async handleSignalEvents(ctx: Context, signalId: string): Promise<void> {
    const sid = signalId.trim();
    if (!sid) {
      await ctx.reply('Укажите ID сделки: /events signalId');
      return;
    }
    const exists = await this.prisma.signal.findFirst({
      where: { id: sid, deletedAt: null },
      select: { id: true },
    });
    if (!exists) {
      await ctx.reply('Сделка не найдена.');
      return;
    }
    const ev = await this.prisma.signalEvent.findMany({
      where: { signalId: sid },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    if (ev.length === 0) {
      await ctx.reply(
        `Событий по этой сделке нет.\n<code>${this.tgEsc(sid)}</code>`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    const lines = ev.map((e) => {
      const payload = e.payload ? this.tgEsc(e.payload.slice(0, 480)) : '—';
      return (
        `<b>${this.tgEsc(e.type)}</b>\n` +
        `<i>${this.tgEsc(this.formatRuDate(e.createdAt))}</i>\n` +
        `${payload}`
      );
    });
    await this.replyHtmlChunks(
      ctx,
      `<b>📌 События сделки</b>\n<code>${this.tgEsc(sid)}</code>\n\n` +
        lines.join('\n\n────────────\n\n'),
    );
  }

  private formatTradesListHtml(items: Signal[]): string {
    const n = items.length;
    const head =
      `<b>📑 Сделки</b> · <b>${n}</b> шт.\n` +
      `<i>Последние ${n} по времени · в списке сначала <b>старые</b>, ниже — новее</i>\n\n`;
    const parts: string[] = [head];
    items.forEach((s, i) => {
      const dir = this.tgEsc((s.direction ?? '').toUpperCase());
      const src = this.tgEsc(s.source ?? '—');
      const st = this.tgEsc(s.status);
      parts.push(
        `<b>${i + 1}.</b> <code>${this.tgEsc(s.pair)}</code> · <b>${dir}</b>`,
        `🆔 <code>${this.tgEsc(s.id)}</code>`,
        `📅 ${this.tgEsc(this.formatRuDate(s.createdAt))} · <code>${st}</code>`,
        `📁 ${src}`,
        '',
      );
    });
    return parts.join('\n');
  }

  private buildTradesNumberKeyboard(items: Array<{ id: string }>) {
    const buttons = items.map((s, i) =>
      Markup.button.callback(String(i + 1), `td:${s.id}`),
    );
    const grid: (typeof buttons)[] = [];
    for (let i = 0; i < buttons.length; i += 5) {
      grid.push(buttons.slice(i, i + 5));
    }
    return Markup.inlineKeyboard(grid);
  }

  private async handleMenuTrades(ctx: Context): Promise<void> {
    const { items } = await this.orders.listTrades({
      page: 1,
      pageSize: 20,
    });
    if (items.length === 0) {
      await ctx.reply('Сделок пока нет.');
      return;
    }
    const ordered = [...items].reverse();
    const listHtml = this.formatTradesListHtml(ordered);
    const chunks = this.splitTelegramHtml(listHtml);
    for (const part of chunks) {
      await ctx.reply(part, { parse_mode: 'HTML' });
    }
    await ctx.reply(
      '<b>Открыть карточку</b>\n<i>Номер совпадает с пунктом в списке выше (1 — самый верхний)</i>',
      {
        parse_mode: 'HTML',
        ...this.buildTradesNumberKeyboard(ordered),
      },
    );
  }

  private formatTradeDetailHtml(signal: Signal & { orders: Order[] }): string {
    let entries: string;
    let tps: string;
    try {
      const e = JSON.parse(signal.entries) as unknown;
      entries = Array.isArray(e) ? e.map((x) => String(x)).join(', ') : signal.entries;
    } catch {
      entries = signal.entries;
    }
    try {
      const t = JSON.parse(signal.takeProfits) as unknown;
      tps = Array.isArray(t) ? t.map((x) => String(x)).join(', ') : signal.takeProfits;
    } catch {
      tps = signal.takeProfits;
    }
    const ordersLines = signal.orders
      .map(
        (o) =>
          `• ${o.orderKind} ${o.side} ${o.status ?? '—'}${o.bybitOrderId != null ? ` · ${o.bybitOrderId}` : ''}`,
      )
      .join('\n');
    const dir = this.tgEsc((signal.direction ?? '').toUpperCase());
    return (
      `<b>📌 Сделка</b>\n` +
      `<code>${this.tgEsc(signal.id)}</code>\n\n` +
      `<b>Пара</b> · <code>${this.tgEsc(signal.pair)}</code>\n` +
      `<b>Сторона</b> · <b>${dir}</b>\n` +
      `<b>Статус</b> · <code>${this.tgEsc(signal.status)}</code>\n\n` +
      `<b>Параметры</b>\n` +
      `├ Входы: <code>${this.tgEsc(entries)}</code>\n` +
      `├ SL: <code>${signal.stopLoss}</code>\n` +
      `├ TP: <code>${this.tgEsc(tps)}</code>\n` +
      `├ Плечо: <code>${signal.leverage}x</code>\n` +
      `└ Размер: <code>${signal.orderUsd > 0 ? `$${signal.orderUsd}` : `${signal.capitalPercent}%`}</code>\n\n` +
      `<b>Источник</b>\n${this.tgEsc(signal.source ?? '—')}\n\n` +
      `<b>Создана</b>\n<i>${this.tgEsc(this.formatRuDate(signal.createdAt))}</i>\n` +
      (signal.realizedPnl != null
        ? `\n<b>PnL</b> · <code>${signal.realizedPnl.toFixed(2)}</code>\n`
        : '') +
      `\n<b>Ордера</b>\n${ordersLines || '—'}`
    );
  }

  private async handleTradeDetailCallback(
    ctx: Context,
    signalId: string,
  ): Promise<void> {
    const row = await this.orders.getSignalWithOrders(signalId);
    if (!row) {
      await ctx.answerCbQuery('Сделка не найдена', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const text = this.formatTradeDetailHtml(row);
    const kbRows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (this.tradeCanCancelFromTelegram(row.status)) {
      kbRows.push([Markup.button.callback('Отменить', `ub_stale_cancel:${signalId}`)]);
    }
    kbRows.push([Markup.button.callback('События', `ev:${signalId}`)]);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(kbRows),
    });
  }

  private registerHandlers(): void {
    if (!this.bot) return;

    const clearInlineKeyboard = async (ctx: Context) => {
      try {
        // Убираем список кнопок у сообщения, по которому кликнули.
        // deleteMessage менее предсказуем (нет прав/старое сообщение), поэтому чистим только клавиатуру.
        // Telegraf: editMessageReplyMarkup принимает объект разметки.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyCtx = ctx as any;
        if (typeof anyCtx.editMessageReplyMarkup === 'function') {
          await anyCtx.editMessageReplyMarkup({ inline_keyboard: [] });
        }
      } catch {
        // ignore (message already edited, no rights, etc.)
      }
    };

    this.bot.use(async (ctx, next) => {
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
      const allowed = await this.isAllowed(uid);
      if (!allowed) {
        this.logger.warn(
          `TG: доступ запрещён userId=${uid}. Проверьте TELEGRAM_WHITELIST (и что ключ загружен из .env).`,
        );
        await ctx.reply('Доступ запрещён.');
        return;
      }
      return next();
    });

    this.bot.hears(/^Сводка$/i, async (ctx) => {
      await this.handleMenuSummary(ctx);
    });
    this.bot.hears(/^Рейтинги$/i, async (ctx) => {
      await this.handleMenuRatings(ctx);
    });
    this.bot.hears(/^Сделки$/i, async (ctx) => {
      await this.handleMenuTrades(ctx);
    });
    this.bot.hears(/^Диагностика$/i, async (ctx) => {
      await this.handleMenuDiagnostics(ctx);
    });
    this.bot.hears(/^Логи$/i, async (ctx) => {
      await this.handleMenuLogs(ctx);
    });

    this.bot.action(/^menu_refresh:summary$/, async (ctx) => {
      await ctx.answerCbQuery('Обновляю…');
      await this.handleMenuSummary(ctx);
    });

    this.bot.action(/^ev:(.+)$/i, async (ctx) => {
      const sid = ctx.match?.[1]?.trim();
      if (!sid) {
        await ctx.answerCbQuery();
        return;
      }
      await ctx.answerCbQuery();
      await this.handleSignalEvents(ctx, sid);
    });

    this.bot.action(/^td:(.+)$/i, async (ctx) => {
      const sid = ctx.match?.[1]?.trim();
      if (!sid) {
        await ctx.answerCbQuery();
        return;
      }
      await this.handleTradeDetailCallback(ctx, sid);
    });

    this.bot.action('sig_confirm', async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) {
        await ctx.answerCbQuery();
        return;
      }
      const draft = this.drafts.get(uid);
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
      await clearInlineKeyboard(ctx);
      await this.applySourceToSignal(uid, draft.signal);
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
        this.drafts.delete(uid);
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

    this.bot.action('sig_cancel', async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) {
        await ctx.answerCbQuery();
        return;
      }
      this.drafts.delete(uid);
      await ctx.answerCbQuery('Черновик отменён');
      await clearInlineKeyboard(ctx);
      await ctx.reply('Черновик сигнала отменён.');
    });

    this.bot.action(/^src_pick:(\d+)$/, async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) { await ctx.answerCbQuery(); return; }
      const draft = this.drafts.get(uid);
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
      this.drafts.set(uid, { phase: 'ready', signal: draft.signal, userTurns: draft.userTurns });
      await ctx.answerCbQuery(`Источник: ${chosen}`);
      await clearInlineKeyboard(ctx);
      const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
      await ctx.reply(this.formatSignalTable(draft.signal, defaultOrderUsd), {
        ...this.confirmKeyboard(),
      });
    });

    this.bot.action('src_none', async (ctx) => {
      const uid = ctx.from?.id;
      if (!uid) { await ctx.answerCbQuery(); return; }
      const draft = this.drafts.get(uid);
      if (draft?.phase !== 'awaiting_source' || !draft.signal) {
        await ctx.answerCbQuery('Нет активного черновика', { show_alert: true });
        return;
      }
      delete draft.signal.source;
      this.drafts.set(uid, { phase: 'ready', signal: draft.signal, userTurns: draft.userTurns });
      await ctx.answerCbQuery('Без источника');
      await clearInlineKeyboard(ctx);
      const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
      await ctx.reply(this.formatSignalTable(draft.signal, defaultOrderUsd), {
        ...this.confirmKeyboard(),
      });
    });

    this.bot.action(/^ub_confirm:(.+)$/i, async (ctx) => {
      const uid = ctx.from?.id;
      const ingestId = ctx.match?.[1];
      if (!uid || !ingestId) {
        await ctx.answerCbQuery();
        return;
      }
      const req = this.externalConfirmations.get(ingestId);
      await ctx.answerCbQuery('Подтверждаю сигнал...');

      const fallback = await this.confirmFromIngestId(ingestId);
      if (!fallback.ok) {
        await req?.onResult?.({
          decision: 'confirmed',
          ok: false,
          error: fallback.error,
          actorUserId: uid,
        });
        await ctx.reply(`Подтверждение не выполнено: ${fallback.error}`);
        return;
      }
      this.externalConfirmations.delete(ingestId);
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

    this.bot.action(/^ub_reject:(.+)$/i, async (ctx) => {
      const uid = ctx.from?.id;
      const ingestId = ctx.match?.[1];
      if (!uid || !ingestId) {
        await ctx.answerCbQuery();
        return;
      }
      const req = this.externalConfirmations.get(ingestId);
      this.externalConfirmations.delete(ingestId);
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

    this.bot.action(/^ub_stale_cancel:(.+)$/i, async (ctx) => {
      const uid = ctx.from?.id;
      const signalId = ctx.match?.[1]?.trim();
      if (!uid || !signalId) {
        await ctx.answerCbQuery();
        return;
      }
      await ctx.answerCbQuery('Отменяю ордера…');
      await clearInlineKeyboard(ctx);
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

    this.bot.on('text', async (ctx) => {
      const text = ctx.message.text?.trim() ?? '';
      const uid = ctx.from?.id;
      if (!uid) return;

      try {
        if (text.startsWith('/')) {
          if (text === '/source' || text.startsWith('/source ')) {
            const rest = text.slice('/source'.length).trim();
            if (!rest) {
              const cur =
                this.sourceOverrideByUser.get(uid)?.trim() ??
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
              this.sourceOverrideByUser.delete(uid);
              await ctx.reply(
                'Переопределение источника сброшено (используются настройки API или текст сигнала).',
              );
              return;
            }
            this.sourceOverrideByUser.set(uid, rest);
            await ctx.reply(`Источник для следующих сигналов: ${rest}`);
            return;
          }
          const eventsCmd = text.match(/^\/(events|события)\s+(\S+)/i);
          if (eventsCmd?.[2]) {
            await this.handleSignalEvents(ctx, eventsCmd[2]);
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
              await this.handleMenuSummary(ctx);
            } else if (text === '/balance' || text === '/баланс') {
              const d = await this.bybit.getUnifiedUsdtBalanceDetails();
              await ctx.reply(
                d !== undefined && Number.isFinite(d.availableUsd)
                  ? `Баланс: ${d.totalUsd.toFixed(2)} USDT\nДоступный баланс: ${d.availableUsd.toFixed(2)} USDT`
                  : 'Баланс недоступен (проверьте ключи Bybit).',
              );
            } else if (text === '/diag' || text === '/диагностика') {
              await this.handleMenuDiagnostics(ctx);
            } else if (text === '/logs' || text === '/логи') {
              await this.handleMenuLogs(ctx);
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
                this.mainMenuKeyboard(),
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
              this.mainMenuKeyboard(),
            );
          } else if (text === '/menu') {
            await ctx.reply(
              'Выберите раздел кнопками или /help для списка команд.',
              this.mainMenuKeyboard(),
            );
          } else if (text === '/cancel') {
            if (this.drafts.delete(uid)) {
              await ctx.reply('Черновик отменён.');
            } else {
              await ctx.reply('Нет активного черновика.');
            }
          }
          return;
        }

        if (this.drafts.has(uid)) {
          const draft = this.drafts.get(uid)!;
          if (draft.phase === 'collecting') {
            this.logger.log(`TG text: continue draft userId=${uid}`);
            const res = await this.transcript.continueSignalDraft(
              draft.partial ?? {},
              draft.userTurns,
              text,
            );
            await this.handleParseResult(ctx, res, text);
            return;
          }
          if (draft.phase === 'ready' && draft.signal) {
            this.logger.log(`TG text: correction draft userId=${uid}`);
            const res = await this.transcript.applyCorrection(
              draft.signal,
              text,
            );
            await this.handleParseResult(ctx, res, text);
            return;
          }
        }

        this.logger.log(`TG text: new signal parse userId=${uid}`);
        const res = await this.transcript.parse('text', { text });
        await this.handleParseResult(ctx, res, text);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`TG text handler: ${msg}`, e instanceof Error ? e.stack : undefined);
        await ctx.reply(`Ошибка бота: ${msg}`);
      }
    });

    this.bot.on('photo', async (ctx) => {
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
      const draft = this.drafts.get(uid);
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
      const res = await this.transcript.parse('image', {
        imageBase64: base64,
        imageMime: 'image/jpeg',
        ...continuation,
      });
      await this.handleParseResult(ctx, res, '[photo]');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`TG photo handler: ${msg}`, e instanceof Error ? e.stack : undefined);
        await ctx.reply(`Ошибка: ${msg}`);
      }
    });

    this.bot.on('voice', async (ctx) => {
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
      const draft = this.drafts.get(uid);
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
      const res = await this.transcript.parse('audio', {
        audioBase64: base64,
        audioMime: 'audio/ogg',
        ...continuation,
      });
      await this.handleParseResult(ctx, res, '[voice]');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.error(`TG voice handler: ${msg}`, e instanceof Error ? e.stack : undefined);
        await ctx.reply(`Ошибка: ${msg}`);
      }
    });
  }

  private async handleParseResult(
    ctx: Context,
    res: import('@repo/shared').TranscriptResult,
    raw: string | undefined,
  ): Promise<void> {
    const uid = ctx.from?.id;
    if (!uid) return;

    if (res.ok === false) {
      this.logger.warn(
        `handleParseResult: parse failed userId=${uid} error=${res.error}`,
      );
      void this.appLog.append('warn', 'telegram', 'parse / transcript error', {
        userId: uid,
        error: res.error,
        details: res.details,
      });
      await ctx.reply(
        `Ошибка: ${res.error}${res.details ? `\n${res.details}` : ''}`,
      );
      return;
    }

    const prev = this.drafts.get(uid);
    const nextTurns = raw ? [...(prev?.userTurns ?? []), raw] : (prev?.userTurns ?? []);

    if (res.ok === 'incomplete') {
      const merged =
        prev?.phase === 'ready' && prev.signal
          ? mergePartialSignals(prev.signal, res.partial)
          : mergePartialSignals(prev?.partial, res.partial);

      this.drafts.set(uid, {
        phase: 'collecting',
        partial: merged,
        userTurns: nextTurns,
      });
      this.logger.log(
        `handleParseResult: incomplete draft userId=${uid} missing=${res.missing.join(',')}`,
      );
      void this.appLog.append('info', 'telegram', 'черновик: неполный сигнал', {
        userId: uid,
        missing: res.missing,
        prompt: res.prompt,
      });
      await ctx.reply(
        `${res.prompt}\n\n${this.formatPartialPreview(merged)}\n\n` +
          `Ответьте сообщением (можно голосом или фото). /cancel — отменить.`,
        this.cancelOnlyKeyboard(),
      );
      return;
    }

    const dup = await this.bybit.wouldDuplicateActivePairDirection(
      res.signal.pair,
      res.signal.direction,
    );
    if (dup) {
      this.logger.warn(
        `handleParseResult: duplicate pair+direction ${res.signal.pair} ${res.signal.direction} userId=${uid}`,
      );
      void this.appLog.append('warn', 'telegram', 'отклонено: дубликат пары и стороны', {
        userId: uid,
        pair: res.signal.pair,
        direction: res.signal.direction,
      });
      this.drafts.delete(uid);
      await ctx.reply(
        `По паре ${res.signal.pair.toUpperCase()} уже есть активный сигнал ${res.signal.direction.toUpperCase()} или открытая позиция/ордера в эту сторону. Повторный вход в ту же сторону недоступен.`,
      );
      return;
    }

    await this.applySourceToSignal(uid, res.signal);

    if (!res.signal.source) {
      const existingSources = await this.getDistinctSources();
      if (existingSources.length > 0) {
        this.drafts.set(uid, {
          phase: 'awaiting_source',
          signal: res.signal,
          userTurns: nextTurns,
          pendingSources: existingSources,
        });
        this.logger.log(
          `handleParseResult: awaiting_source userId=${uid} pair=${res.signal.pair} sources=${existingSources.length}`,
        );
        void this.appLog.append('info', 'telegram', 'черновик: выбор источника', {
          userId: uid,
          pair: res.signal.pair,
          sources: existingSources,
        });
        const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
        await ctx.reply(
          this.formatSignalTable(res.signal, defaultOrderUsd) +
            '\n\nВыберите источник сигнала или продолжите без него:',
          { ...this.sourceSelectionKeyboard(existingSources) },
        );
        return;
      }
    }

    this.drafts.set(uid, {
      phase: 'ready',
      signal: res.signal,
      userTurns: nextTurns,
    });
    this.logger.log(
      `handleParseResult: draft ready userId=${uid} pair=${res.signal.pair}`,
    );
    void this.appLog.append('info', 'telegram', 'черновик готов к подтверждению', {
      userId: uid,
      pair: res.signal.pair,
      direction: res.signal.direction,
      orderUsd: res.signal.orderUsd,
    });
    const defaultOrderUsd = await this.getResolvedDefaultOrderUsd();
    await ctx.reply(this.formatSignalTable(res.signal, defaultOrderUsd), {
      ...this.confirmKeyboard(),
    });
  }

  private async confirmFromIngestId(ingestId: string): Promise<{
    ok: boolean;
    error?: string;
    signalId?: string;
    bybitOrderIds?: string[];
  }> {
    const row = await this.prisma.tgUserbotIngest.findUnique({
      where: { id: ingestId },
      select: { text: true, chatId: true },
    });
    const text = row?.text?.trim();
    if (!text) {
      return { ok: false, error: 'Текст сообщения для подтверждения не найден' };
    }
    const [chat, details] = await Promise.all([
      row?.chatId
        ? this.prisma.tgUserbotChat.findUnique({
            where: { chatId: row.chatId },
            select: { title: true, defaultLeverage: true, defaultEntryUsd: true },
          })
        : Promise.resolve(null),
      this.bybit.getUnifiedUsdtBalanceDetails(),
    ]);
    const defaultOrderUsd = await this.settings.resolveDefaultEntryUsd({
      rawOverride: chat?.defaultEntryUsd,
      balanceTotalUsd: details?.totalUsd,
    });
    const leverageDefault =
      chat?.defaultLeverage != null && chat.defaultLeverage >= 1
        ? chat.defaultLeverage
        : undefined;
    const parsed = await this.transcript.parse(
      'text',
      { text },
      { defaultOrderUsd, leverageDefault },
    );
    if (parsed.ok !== true) {
      return {
        ok: false,
        error:
          parsed.ok === false
            ? parsed.error
            : `Сигнал неполный: ${parsed.prompt}`,
      };
    }
    if (chat?.title) {
      parsed.signal.source = chat.title;
    }
    const place = await this.bybit.placeSignalOrders(parsed.signal, text);
    if (!place.ok) {
      return { ok: false, error: formatError(place.error) };
    }
    await this.prisma.tgUserbotIngest
      .update({
        where: { id: ingestId },
        data: { status: 'placed', error: null },
      })
      .catch(() => undefined);
    return {
      ok: true,
      signalId: place.signalId,
      bybitOrderIds: place.bybitOrderIds,
    };
  }
}
