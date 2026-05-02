import type { Order, Signal } from '@prisma/client';

import { escapeTelegramHtml, formatRuDate } from './telegram-html.util';
import {
  parseNumberArrayFromJson,
  parseTakeProfitsForDisplay,
} from './telegram-trade-parse.util';
import { formatEntryLineText } from './telegram-signal-message-format.util';
import type { TelegramSourceRatingRow } from '../types/telegram.types';

export function formatRatingSection(
  emoji: string,
  title: string,
  rows: TelegramSourceRatingRow[],
): string {
  if (rows.length === 0) {
    return `<b>${emoji} ${escapeTelegramHtml(title)}</b>\n<i>нет данных</i>`;
  }
  const blocks = rows.map((r, i) => {
    const src = escapeTelegramHtml(r.source ?? '—');
    return (
      `<b>${i + 1}.</b> <code>${src}</code>\n` +
      `├ PnL <b>${r.totalPnl.toFixed(2)}</b> · WR <b>${r.winrate.toFixed(1)}%</b>\n` +
      `└ W/L ${r.wL} · закр. ${r.totalClosed} · откр. ${r.openSignals}`
    );
  });
  return `<b>${emoji} ${escapeTelegramHtml(title)}</b>\n\n` + blocks.join('\n\n');
}

export function formatTradesListHtml(items: Signal[]): string {
  const n = items.length;
  const head =
    `<b>📑 Сделки</b> · <b>${n}</b> шт.\n` +
    `<i>Последние ${n} по времени · в списке сначала <b>старые</b>, ниже — новее</i>\n\n`;
  const parts: string[] = [head];
  items.forEach((s, i) => {
    const dir = escapeTelegramHtml((s.direction ?? '').toUpperCase());
    const src = escapeTelegramHtml(s.source ?? '—');
    const st = escapeTelegramHtml(s.status);
    parts.push(
      `<b>${i + 1}.</b> <code>${escapeTelegramHtml(s.pair)}</code> · <b>${dir}</b>`,
      `🆔 <code>${escapeTelegramHtml(s.id)}</code>`,
      `📅 ${escapeTelegramHtml(formatRuDate(s.createdAt))} · <code>${st}</code>`,
      `📁 ${src}`,
      '',
    );
  });
  return parts.join('\n');
}

export function formatTradeDetailHtml(signal: Signal & { orders: Order[] }): string {
  const entryNums = parseNumberArrayFromJson(signal.entries);
  const entryLine = escapeTelegramHtml(
    entryNums.length > 0
      ? formatEntryLineText({
          entryPrices: entryNums,
          entryIsRange: signal.entryIsRange,
        })
      : String(signal.entries),
  );
  const tps = parseTakeProfitsForDisplay(signal.takeProfits);
  const ordersLines = signal.orders
    .map(
      (o) =>
        `• ${o.orderKind} ${o.side} ${o.status ?? '—'}${o.bybitOrderId != null ? ` · ${o.bybitOrderId}` : ''}`,
    )
    .join('\n');
  const dir = escapeTelegramHtml((signal.direction ?? '').toUpperCase());
  return (
    `<b>📌 Сделка</b>\n` +
    `<code>${escapeTelegramHtml(signal.id)}</code>\n\n` +
    `<b>Пара</b> · <code>${escapeTelegramHtml(signal.pair)}</code>\n` +
    `<b>Сторона</b> · <b>${dir}</b>\n` +
    `<b>Статус</b> · <code>${escapeTelegramHtml(signal.status)}</code>\n\n` +
    `<b>Параметры</b>\n` +
    `├ <code>${entryLine}</code>\n` +
    `├ SL: <code>${signal.stopLoss}</code>\n` +
    `├ TP: <code>${escapeTelegramHtml(tps)}</code>\n` +
    `├ Плечо: <code>${signal.leverage}x</code>\n` +
    `└ Размер: <code>${signal.orderUsd > 0 ? `$${signal.orderUsd}` : `${signal.capitalPercent}%`}</code>\n\n` +
    `<b>Источник</b>\n${escapeTelegramHtml(signal.source ?? '—')}\n\n` +
    `<b>Создана</b>\n<i>${escapeTelegramHtml(formatRuDate(signal.createdAt))}</i>\n` +
    (signal.realizedPnl != null
      ? `\n<b>PnL</b> · <code>${signal.realizedPnl.toFixed(2)}</code>\n`
      : '') +
    `\n<b>Ордера</b>\n${ordersLines || '—'}`
  );
}
