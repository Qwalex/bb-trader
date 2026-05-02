import { escapeTelegramHtml } from './telegram-html.util';
import { formatEntryLineText } from './telegram-signal-message-format.util';

export function formatUserbotSignalFailureMessage(params: {
  ingestId: string;
  chatId: string;
  groupTitle?: string;
  token: string;
  stage: 'classify' | 'transcript' | 'bybit';
  error: string;
  missingData?: string[];
}): string {
  const stageText =
    params.stage === 'classify'
      ? 'классификации'
      : params.stage === 'transcript'
        ? 'транскрибации/разбора'
        : 'установки ордеров на Bybit';
  const missing =
    params.missingData && params.missingData.length > 0
      ? `\nНе хватило данных: ${params.missingData.join(', ')}`
      : '';
  const sourceLine =
    params.groupTitle && params.groupTitle.trim().length > 0
      ? `Группа / канал: ${params.groupTitle.trim()}\n`
      : `Источник (chatId): ${params.chatId}\n`;
  return (
    `Ошибка обработки сигнала из группы\n` +
    sourceLine +
    `Токен: ${params.token}\n` +
    `Этап: ${stageText}\n` +
    `Причина: ${params.error}${missing}\n\n` +
    `ingestId: ${params.ingestId}`
  );
}

export function formatUserbotResultWithoutEntryHtml(params: {
  ingestId: string;
  chatId: string;
  groupTitle?: string;
  pair: string;
  signalId: string;
  resultMessageText: string;
  quotedSnippet?: string;
}): string {
  const pair = escapeTelegramHtml((params.pair ?? '').trim().toUpperCase());
  const sourceLine =
    params.groupTitle && params.groupTitle.trim().length > 0
      ? `Группа / канал: ${escapeTelegramHtml(params.groupTitle.trim())}\n`
      : `Источник (chatId): ${escapeTelegramHtml(String(params.chatId))}\n`;
  const resultBody = (params.resultMessageText ?? '').trim() || '—';
  const quoteBody = (params.quotedSnippet ?? '').trim();
  const quoteBlock =
    quoteBody.length > 0
      ? `\n\nЦитата из группы:\n<pre>${escapeTelegramHtml(quoteBody)}</pre>\n`
      : '\n';
  return (
    `Возможно ваш ордер для монеты <b>${pair}</b> не актуален\n` +
    sourceLine +
    `\nПолучен результат:\n<pre>${escapeTelegramHtml(resultBody)}</pre>` +
    quoteBlock +
    `\nА вход так и не был осуществлен по сделке (<code>${escapeTelegramHtml(params.signalId)}</code>)\n\n` +
    `ingestId: <code>${escapeTelegramHtml(params.ingestId)}</code>`
  );
}

export function formatApiTradeCancelledHtml(params: {
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
  reason?: string;
}): string {
  const pair = escapeTelegramHtml((params.pair ?? '').trim().toUpperCase());
  const signalId = escapeTelegramHtml((params.signalId ?? '').trim());
  const direction = escapeTelegramHtml((params.direction ?? '').trim().toUpperCase());
  const entryLine = escapeTelegramHtml(
    params.entries.length > 0
      ? formatEntryLineText({
          entryPrices: params.entries,
          entryIsRange: params.entryIsRange,
        })
      : '—',
  );
  const stopLoss = escapeTelegramHtml(String(params.stopLoss));
  const takeProfits = escapeTelegramHtml(
    params.takeProfits.length > 0
      ? params.takeProfits.map((v) => String(v)).join(', ')
      : '—',
  );
  const leverage = escapeTelegramHtml(`${params.leverage}x`);
  const size =
    params.capitalPercent > 0
      ? escapeTelegramHtml(`${params.capitalPercent}% от депозита`)
      : escapeTelegramHtml(`$${params.orderUsd} USDT`);
  const source = params.source ? escapeTelegramHtml(params.source) : '—';
  const reasonLine = params.reason
    ? `\nПричина: ${escapeTelegramHtml(params.reason)}`
    : '';
  return (
    `<b>Сделка отменена</b>\n` +
    `Пара: <code>${pair}</code>\n` +
    `ID сделки: <code>${signalId}</code>\n` +
    `Направление: <code>${direction}</code>\n` +
    `<code>${entryLine}</code>\n` +
    `Stop Loss: <code>${stopLoss}</code>\n` +
    `Take Profit: <code>${takeProfits}</code>\n` +
    `Плечо: <code>${leverage}</code>\n` +
    `Размер: <code>${size}</code>\n` +
    `Источник: <code>${source}</code>${reasonLine}`
  );
}

export function formatApiTradeLiquidationHtml(params: {
  signalId: string;
  pair: string;
  direction: string;
  leverage: number;
  source?: string | null;
  realizedPnl?: number | null;
}): string {
  const pair = escapeTelegramHtml((params.pair ?? '').trim().toUpperCase());
  const signalId = escapeTelegramHtml((params.signalId ?? '').trim());
  const direction = escapeTelegramHtml((params.direction ?? '').trim().toUpperCase());
  const leverage = escapeTelegramHtml(`${Math.max(1, Math.round(params.leverage || 1))}x`);
  const source = params.source ? escapeTelegramHtml(params.source) : '—';
  const pnlLine =
    typeof params.realizedPnl === 'number' && Number.isFinite(params.realizedPnl)
      ? `\nRealized PnL: <code>${escapeTelegramHtml(String(params.realizedPnl))}</code>`
      : '';
  return (
    `<b>Ликвидация позиции</b>\n` +
    `Пара: <code>${pair}</code>\n` +
    `ID сделки: <code>${signalId}</code>\n` +
    `Направление: <code>${direction}</code>\n` +
    `Плечо: <code>${leverage}</code>\n` +
    `Источник: <code>${source}</code>${pnlLine}`
  );
}
