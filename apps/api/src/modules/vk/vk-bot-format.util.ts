/**
 * Копия текстовых форматтеров из telegram.service.ts (без правок Telegram).
 * При изменении логики в Telegram — синхронизировать вручную.
 */
import type { SignalDto } from '@repo/shared';

import type { Signal, Order } from '@prisma/client';

export function vkFormatEntryLineText(params: {
  entryPrices: number[];
  entryIsRange?: boolean;
}): string {
  const prices = params.entryPrices.join(', ');
  if (params.entryIsRange === true && params.entryPrices.length === 2) {
    return `Входы (зона): ${prices}`;
  }
  if (params.entryIsRange === false && params.entryPrices.length > 1) {
    return `Входы (DCA): ${prices}`;
  }
  return `Входы: ${prices}`;
}

export function vkFormatSignalTable(s: SignalDto, defaultOrderUsd: number): string {
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
  const entryLine = vkFormatEntryLineText({
    entryPrices: s.entries,
    entryIsRange: s.entryIsRange,
  });
  return (
    `Сигнал (проверьте данные):\n` +
    `Пара: ${s.pair}\n` +
    `Сторона: ${s.direction.toUpperCase()}\n` +
    `${entryLine}\n` +
    `SL: ${s.stopLoss}\n` +
    `TP: ${s.takeProfits.join(', ')}${tpExtra}\n` +
    `Плечо: ${s.leverage}x\n` +
    `${sizing}${src}\n\n` +
    `Отправьте текст с правками или нажмите «Подтвердить».`
  );
}

export function vkFormatPartialPreview(p: Partial<SignalDto>): string {
  const lines: string[] = ['Черновик (что уже есть):'];
  if (p.pair) lines.push(`Пара: ${p.pair}`);
  if (p.direction) lines.push(`Сторона: ${p.direction.toUpperCase()}`);
  if (p.entries?.length) {
    lines.push(
      vkFormatEntryLineText({
        entryPrices: p.entries,
        entryIsRange: p.entryIsRange,
      }),
    );
  }
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

export function vkFormatExternalSignalTable(s: SignalDto, defaultOrderUsd: number): string {
  const src = s.source ? `\nИсточник: ${s.source}` : '';
  const sizing =
    s.orderUsd > 0
      ? `Сумма: $${s.orderUsd} USDT (номинал)`
      : s.capitalPercent > 0
        ? `Капитал: ${s.capitalPercent}% от депозита`
        : `Сумма: $${defaultOrderUsd} USDT (по умолчанию)`;
  const entryLine = vkFormatEntryLineText({
    entryPrices: s.entries,
    entryIsRange: s.entryIsRange,
  });
  return (
    `Новый сигнал из Telegram Userbot\n` +
    `Пара: ${s.pair}\n` +
    `Сторона: ${s.direction.toUpperCase()}\n` +
    `${entryLine}\n` +
    `SL: ${s.stopLoss}\n` +
    `TP: ${s.takeProfits.join(', ')}\n` +
    `Плечо: ${s.leverage}x\n` +
    `${sizing}${src}\n\n` +
    `Подтвердите или отклоните сигнал.`
  );
}

export function vkSplitMessage(text: string, max = 3900): string[] {
  const t = text.trim();
  if (t.length === 0) return [];
  if (t.length <= max) return [t];
  const parts: string[] = [];
  let rest = t;
  while (rest.length > max) {
    const slice = rest.slice(0, max);
    const lastBreak = slice.lastIndexOf('\n');
    const cut = lastBreak > max * 0.4 ? lastBreak : max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length) parts.push(rest);
  return parts;
}

export function vkFormatRuDate(d: Date): string {
  return new Date(d).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function vkFormatTradesListPlain(items: Signal[]): string {
  const n = items.length;
  const head = `Сделки · ${n} шт.\n(в списке сначала старые, ниже — новее)\n\n`;
  const parts: string[] = [head];
  items.forEach((s, i) => {
    const dir = (s.direction ?? '').toUpperCase();
    const src = s.source ?? '—';
    const st = s.status;
    parts.push(
      `${i + 1}. ${s.pair} · ${dir}`,
      `ID ${s.id}`,
      `${vkFormatRuDate(s.createdAt)} · ${st}`,
      `Источник: ${src}`,
      '',
    );
  });
  return parts.join('\n');
}

export function vkFormatTradeDetailPlain(signal: Signal & { orders: Order[] }): string {
  let entryNums: number[] = [];
  try {
    const e = JSON.parse(signal.entries) as unknown;
    if (Array.isArray(e)) {
      entryNums = e.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    }
  } catch {
    entryNums = [];
  }
  const entryLine =
    entryNums.length > 0
      ? vkFormatEntryLineText({
          entryPrices: entryNums,
          entryIsRange: signal.entryIsRange,
        })
      : String(signal.entries);
  let tps: string;
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
  const dir = (signal.direction ?? '').toUpperCase();
  return (
    `Сделка\n` +
    `${signal.id}\n\n` +
    `Пара · ${signal.pair}\n` +
    `Сторона · ${dir}\n` +
    `Статус · ${signal.status}\n\n` +
    `Параметры\n` +
    `${entryLine}\n` +
    `SL: ${signal.stopLoss}\n` +
    `TP: ${tps}\n` +
    `Плечо: ${signal.leverage}x\n` +
    `Размер: ${signal.orderUsd > 0 ? `$${signal.orderUsd}` : `${signal.capitalPercent}%`}\n\n` +
    `Источник\n${signal.source ?? '—'}\n\n` +
    `Создана\n${vkFormatRuDate(signal.createdAt)}\n` +
    (signal.realizedPnl != null ? `\nPnL · ${signal.realizedPnl.toFixed(2)}\n` : '') +
    `\nОрдера\n${ordersLines || '—'}`
  );
}
