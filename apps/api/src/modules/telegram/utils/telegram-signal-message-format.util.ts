import type { SignalDto } from '@repo/shared';

/** Подпись строки входов: зона vs DCA (для текста и HTML). */
export function formatEntryLineText(params: {
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

export function formatSignalTable(s: SignalDto, defaultOrderUsd: number): string {
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
  const entryLine = formatEntryLineText({
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

/** Кратко показать, что уже известно в черновике. */
export function formatPartialPreview(p: Partial<SignalDto>): string {
  const lines: string[] = ['Черновик (что уже есть):'];
  if (p.pair) lines.push(`Пара: ${p.pair}`);
  if (p.direction) lines.push(`Сторона: ${p.direction.toUpperCase()}`);
  if (p.entries?.length) {
    lines.push(
      formatEntryLineText({
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

export function formatExternalSignalTable(s: SignalDto, defaultOrderUsd: number): string {
  const src = s.source ? `\nИсточник: ${s.source}` : '';
  const sizing =
    s.orderUsd > 0
      ? `Сумма: $${s.orderUsd} USDT (номинал)`
      : s.capitalPercent > 0
        ? `Капитал: ${s.capitalPercent}% от депозита`
        : `Сумма: $${defaultOrderUsd} USDT (по умолчанию)`;
  const entryLine = formatEntryLineText({
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
