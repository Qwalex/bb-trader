import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Context, Markup } from 'telegraf';

import { PrismaService } from '../../../prisma/prisma.service';
import { AppLogService } from '../../app-log/app-log.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { BybitService } from '../../bybit/bybit.service';
import { OrdersService } from '../../orders/orders.service';
import { SettingsService } from '../../settings/settings.service';
import {
  formatRatingSection,
  formatTradesListHtml,
  formatTradeDetailHtml,
} from '../utils/telegram-dashboard-html.util';
import {
  escapeTelegramHtml,
  formatRuDate,
  replyTelegramHtmlChunks,
  splitTelegramHtml,
  startOfToday,
} from '../utils/telegram-html.util';
import {
  buildTradesNumberKeyboard,
} from '../utils/telegram-keyboards.util';
import { tradeCanCancelFromTelegram } from '../utils/telegram-trade-status.util';
import type { TelegramSourceRatingRow } from '../types/telegram.types';

@Injectable()
export class TelegramChatMenuService {
  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => BybitService))
    private readonly bybit: BybitService,
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
    private readonly appLog: AppLogService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  private currentCabinetId(): string | null {
    return this.cabinetContext.getCabinetId();
  }

  private async getBoolSetting(key: string, fallback: boolean): Promise<boolean> {
    const raw = await this.settings.get(key);
    if (raw == null || raw.trim() === '') {
      return fallback;
    }
    return raw.trim().toLowerCase() === 'true';
  }

  async handleMenuSummary(
    ctx: Context,
    opts?: { edit?: { chatId: number; messageId: number } },
  ): Promise<void> {
    const [details, bundle] = await Promise.all([
      this.bybit.getUnifiedUsdtBalanceDetails(),
      this.orders.getTelegramMenuSummaryBundle(),
    ]);
    const balStr =
      details !== undefined && Number.isFinite(details.availableUsd)
        ? `баланс ${details.totalUsd.toFixed(2)} · доступный баланс ${details.availableUsd.toFixed(2)} USDT`
        : '—';
    const todayPnlStr = bundle.todayPnl.toFixed(2);
    const best = bundle.bestWinrate;
    const worst = bundle.worstWinrate;
    let lines =
      `<b>📊 Сводка</b>\n` +
      `<i>Как на дашборде · все источники</i>\n\n` +
      `<b>💵 USDT</b> (Bybit)\n<code>${escapeTelegramHtml(balStr)}</code>\n\n` +
      `<b>📅 PnL за сегодня</b> (закрытые)\n<code>${escapeTelegramHtml(todayPnlStr)}</code>\n\n` +
      `<b>📈 Winrate</b>\n<code>${bundle.winrate.toFixed(1)}%</code>\n\n` +
      `<b>Σ PnL всего</b>\n<code>${bundle.totalPnl.toFixed(2)}</code>\n\n` +
      `<b>Закрыто</b> · ${bundle.totalClosed} <i>(W ${bundle.wins} / L ${bundle.losses})</i>\n` +
      `<b>Открытые сигналы</b> · ${bundle.openSignals}\n`;
    if (best) {
      lines +=
        `\n────────────\n<b>▲ Лучший WR</b> по источнику\n` +
        `<code>${escapeTelegramHtml(best.source ?? '—')}</code>\n` +
        `<b>${best.winrate.toFixed(1)}%</b> · W/L ${best.wL}`;
    }
    if (worst) {
      lines +=
        `\n────────────\n<b>▼ Худший WR</b> по источнику\n` +
        `<code>${escapeTelegramHtml(worst.source ?? '—')}</code>\n` +
        `<b>${worst.winrate.toFixed(1)}%</b> · W/L ${worst.wL}`;
    }
    const parts = splitTelegramHtml(lines);
    const refreshKb = Markup.inlineKeyboard([
      [Markup.button.callback('Обновить сводку', 'menu_refresh:summary')],
    ]);
    const first = parts[0] ?? lines;
    const body =
      parts.length > 1
        ? `${first}\n\n<i>…сокращено (слишком длинная сводка для одного сообщения)</i>`
        : first;

    if (opts?.edit) {
      try {
        await ctx.telegram.editMessageText(
          opts.edit.chatId,
          opts.edit.messageId,
          undefined,
          body,
          { parse_mode: 'HTML', ...refreshKb },
        );
        return;
      } catch {
        // Если нельзя редактировать (старое/удалено/нет прав) — шлём новую сводку
      }
    }

    await ctx.reply(body, { parse_mode: 'HTML', ...refreshKb });
  }

  async handleMenuRatings(ctx: Context): Promise<void> {
    const top = await this.orders.getTopSources({ limit: 5 });
    await ctx.reply(
      '<b>⭐ Рейтинги</b>\n<i>Топ-5 в каждом блоке · ниже — по одному сообщению на блок</i>',
      { parse_mode: 'HTML' },
    );
    const blocks: [string, string, TelegramSourceRatingRow[]][] = [
      ['💰', 'Топ по PnL', top.byPnl],
      ['📈', 'Топ по Winrate', top.byWinrate],
      ['📉', 'Худший PnL', top.byWorstPnl],
      ['⚠️', 'Худший Winrate', top.byWorstWinrate],
    ];
    for (const [emoji, title, rows] of blocks) {
      await ctx.reply(formatRatingSection(emoji, title, rows), {
        parse_mode: 'HTML',
      });
    }
  }

  async handleMenuDiagnostics(ctx: Context): Promise<void> {
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
    const start = startOfToday();
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
        cabinetId: this.currentCabinetId(),
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
    await replyTelegramHtmlChunks(ctx, html);
  }

  async handleMenuLogs(ctx: Context): Promise<void> {
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
        `<code>${escapeTelegramHtml(r.level)}</code> · <code>${escapeTelegramHtml(r.category)}</code>\n` +
        `<i>${escapeTelegramHtml(when)}</i>\n` +
        `${escapeTelegramHtml(msg)}`
      );
    });
    const body =
      `<b>📋 Журнал</b> · записей: <b>${rows.length}</b>\n` +
      `<i>Сначала новее</i>\n\n` +
      blocks.join('\n\n────────────\n\n');
    await replyTelegramHtmlChunks(ctx, body);
  }

  async handleSignalEvents(ctx: Context, signalId: string): Promise<void> {
    const sid = signalId.trim();
    if (!sid) {
      await ctx.reply('Укажите ID сделки: /events signalId');
      return;
    }
    const exists = await this.prisma.signal.findFirst({
      where: { id: sid, cabinetId: this.currentCabinetId(), deletedAt: null },
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
        `Событий по этой сделке нет.\n<code>${escapeTelegramHtml(sid)}</code>`,
        { parse_mode: 'HTML' },
      );
      return;
    }
    const lines = ev.map((e) => {
      const payload = e.payload ? escapeTelegramHtml(e.payload.slice(0, 480)) : '—';
      return (
        `<b>${escapeTelegramHtml(e.type)}</b>\n` +
        `<i>${escapeTelegramHtml(formatRuDate(e.createdAt))}</i>\n` +
        `${payload}`
      );
    });
    await replyTelegramHtmlChunks(
      ctx,
      `<b>📌 События сделки</b>\n<code>${escapeTelegramHtml(sid)}</code>\n\n` +
        lines.join('\n\n────────────\n\n'),
    );
  }

  async handleMenuTrades(ctx: Context): Promise<void> {
    const { items } = await this.orders.listTrades({
      page: 1,
      pageSize: 20,
    });
    if (items.length === 0) {
      await ctx.reply('Сделок пока нет.');
      return;
    }
    const ordered = [...items].reverse();
    const listHtml = formatTradesListHtml(ordered);
    const chunks = splitTelegramHtml(listHtml);
    for (const part of chunks) {
      await ctx.reply(part, { parse_mode: 'HTML' });
    }
    await ctx.reply(
      '<b>Открыть карточку</b>\n<i>Номер совпадает с пунктом в списке выше (1 — самый верхний)</i>',
      {
        parse_mode: 'HTML',
        ...buildTradesNumberKeyboard(ordered),
      },
    );
  }

  async handleTradeDetailCallback(
    ctx: Context,
    signalId: string,
  ): Promise<void> {
    const row = await this.orders.getSignalWithOrders(signalId);
    if (!row) {
      await ctx.answerCbQuery('Сделка не найдена', { show_alert: true });
      return;
    }
    await ctx.answerCbQuery();
    const text = formatTradeDetailHtml(row);
    const kbRows: ReturnType<typeof Markup.button.callback>[][] = [];
    if (tradeCanCancelFromTelegram(row.status)) {
      kbRows.push([Markup.button.callback('Отменить', `ub_stale_cancel:${signalId}`)]);
    }
    kbRows.push([Markup.button.callback('События', `ev:${signalId}`)]);
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(kbRows),
    });
  }
}
