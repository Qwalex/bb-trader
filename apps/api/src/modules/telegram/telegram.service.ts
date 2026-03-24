import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Context, Markup, Telegraf } from 'telegraf';

import type { SignalDto } from '@repo/shared';

import { formatError } from '../../common/format-error';
import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { BybitService } from '../bybit/bybit.service';
import { SettingsService } from '../settings/settings.service';
import {
  mergePartialSignals,
  sanitizeSignalSource,
} from '../transcript/partial-signal.util';
import { TranscriptService } from '../transcript/transcript.service';

type DraftPhase = 'collecting' | 'ready';

type DraftSession = {
  phase: DraftPhase;
  /** Сообщения пользователя с начала сессии (контекст до подтверждения). */
  userTurns: string[];
  /** Готовый сигнал после полного разбора. */
  signal?: SignalDto;
  /** Накопленные поля, пока не хватает данных. */
  partial?: Partial<SignalDto>;
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
    private readonly bybit: BybitService,
    private readonly appLog: AppLogService,
    private readonly prisma: PrismaService,
  ) {}

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

  private formatSignalTable(s: SignalDto): string {
    const src = s.source ? `\nИсточник: ${s.source}` : '';
    const sizing =
      s.orderUsd > 0
        ? `Сумма: $${s.orderUsd} USDT (номинал)`
        : s.capitalPercent > 0
          ? `Капитал: ${s.capitalPercent}% от депозита (номинал с плечом)`
          : `Сумма: $10 USDT (по умолчанию)`;
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

  private formatExternalSignalTable(s: SignalDto): string {
    const src = s.source ? `\nИсточник: ${s.source}` : '';
    const sizing =
      s.orderUsd > 0
        ? `Сумма: $${s.orderUsd} USDT (номинал)`
        : s.capitalPercent > 0
          ? `Капитал: ${s.capitalPercent}% от депозита`
          : `Сумма: $10 USDT (по умолчанию)`;
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
    const msg = this.formatExternalSignalTable(params.signal);
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
    const msg =
      `Ошибка обработки сигнала из группы\n` +
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

  private registerHandlers(): void {
    if (!this.bot) return;

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
      await ctx.reply('Черновик сигнала отменён.');
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
          if (text === '/start') {
            await ctx.reply(
              'Отправьте сигнал текстом, фото или голосом. Если чего-то не хватает — бот задаст вопросы; отвечайте сообщениями, контекст сохраняется до подтверждения.\n' +
                'После полного разбора проверьте таблицу, при необходимости пришлите правки текстом, затем «Подтвердить».\n' +
                'Источник сигнала (канал/приложение, для статистики): задайте в настройках API или командой /source Название.\n' +
                'Команды: /cancel — отменить черновик',
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

    const dup = await this.bybit.wouldDuplicateActivePair(res.signal.pair);
    if (dup) {
      this.logger.warn(
        `handleParseResult: duplicate pair ${res.signal.pair} userId=${uid}`,
      );
      void this.appLog.append('warn', 'telegram', 'отклонено: дубликат пары', {
        userId: uid,
        pair: res.signal.pair,
      });
      this.drafts.delete(uid);
      await ctx.reply(
        `По паре ${res.signal.pair.toUpperCase()} уже есть активный сигнал или открытая позиция на бирже. Новый вход недоступен, пока сделка не закрыта.`,
      );
      return;
    }

    await this.applySourceToSignal(uid, res.signal);
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
    await ctx.reply(this.formatSignalTable(res.signal), {
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
    const parsed = await this.transcript.parse('text', { text });
    if (parsed.ok !== true) {
      return {
        ok: false,
        error:
          parsed.ok === false
            ? parsed.error
            : `Сигнал неполный: ${parsed.prompt}`,
      };
    }
    const chat = row?.chatId
      ? await this.prisma.tgUserbotChat.findUnique({
          where: { chatId: row.chatId },
          select: { title: true },
        })
      : null;
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
