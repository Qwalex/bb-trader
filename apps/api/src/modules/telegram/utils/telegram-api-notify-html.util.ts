import { escapeTelegramHtml } from './telegram-html.util';
import { formatEntryLineText } from './telegram-signal-message-format.util';

export function formatUserbotSignalFailureMessage(params: {
  ingestId: string;
  chatId: string;
  groupTitle?: string;
  token: string;
  stage: 'classify' | 'transcript' | 'bybit' | 'ingest';
  error: string;
  missingData?: string[];
}): string {
  const stageText =
    params.stage === 'classify'
      ? 'классификации'
      : params.stage === 'transcript'
        ? 'транскрибации/разбора'
        : params.stage === 'bybit'
          ? 'установки ордеров на Bybit'
          : 'проверки дубликата и лимитов';
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

function formatHedgeAuditSideHtml(params: {
  title: string;
  signalId: string | null;
  pair: string;
  direction: string;
  status?: string | null;
  entries: number[];
  entryIsRange?: boolean;
  stopLoss: number;
  takeProfits: number[];
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
  source?: string | null;
  extraNote?: string | null;
}): string {
  const pair = escapeTelegramHtml((params.pair ?? '').trim().toUpperCase());
  const dir = escapeTelegramHtml((params.direction ?? '').trim().toUpperCase());
  const sid =
    params.signalId && params.signalId.trim().length > 0
      ? escapeTelegramHtml(params.signalId.trim())
      : '—';
  const statusLine =
    params.status && params.status.trim().length > 0
      ? `\nСтатус в БД: <code>${escapeTelegramHtml(params.status.trim())}</code>`
      : '';
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
  const source = params.source?.trim() ? escapeTelegramHtml(params.source.trim()) : '—';
  const extra =
    params.extraNote && params.extraNote.trim().length > 0
      ? `\n${escapeTelegramHtml(params.extraNote.trim())}`
      : '';
  return (
    `<b>${escapeTelegramHtml(params.title)}</b>\n` +
    `Пара: <code>${pair}</code>\n` +
    `Направление: <code>${dir}</code>\n` +
    `ID сделки: <code>${sid}</code>${statusLine}\n` +
    `<code>${entryLine}</code>\n` +
    `Stop Loss: <code>${stopLoss}</code>\n` +
    `Take Profit: <code>${takeProfits}</code>\n` +
    `Плечо: <code>${leverage}</code>\n` +
    `Размер: <code>${size}</code>\n` +
    `Источник: <code>${source}</code>${extra}`
  );
}

export function formatHedgeOppositePlacementAuditHtml(params: {
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
}): string {
  const sym = escapeTelegramHtml((params.symbol ?? '').trim().toUpperCase());
  const hedge = params.hedgeModeActive ? 'вкл' : 'выкл';
  const exch = params.oppositeOnExchange ? 'да' : 'нет';
  const head =
    `<b>Аудит: вторая сторона по паре (hedge)</b>\n` +
    `Символ: <code>${sym}</code>\n` +
    `Hedge-режим (оценка API): <code>${escapeTelegramHtml(hedge)}</code>\n` +
    `Противоположная сторона на бирже до входа: <code>${escapeTelegramHtml(exch)}</code>\n\n`;

  let existingBlock: string;
  if (params.existingOppositeDb) {
    const e = params.existingOppositeDb;
    existingBlock = formatHedgeAuditSideHtml({
      title: 'Уже была сделка (противоположное направление)',
      signalId: e.id,
      pair: e.pair,
      direction: e.direction,
      status: e.status,
      entries: e.entries,
      entryIsRange: e.entryIsRange,
      stopLoss: e.stopLoss,
      takeProfits: e.takeProfits,
      leverage: e.leverage,
      orderUsd: e.orderUsd,
      capitalPercent: e.capitalPercent,
      source: e.source,
      extraNote: null,
    });
  } else if (params.oppositeOnExchange) {
    const d = params.newPlaced.direction === 'long' ? 'SHORT' : 'LONG';
    existingBlock =
      `<b>Противоположная сторона на бирже</b>\n` +
      `Пара: <code>${sym}</code>\n` +
      `Сторона на бирже: <code>${escapeTelegramHtml(d)}</code>\n` +
      `Активной сделки с этим направлением в БД не найдено — возможна ручная позиция или ордера вне сигнал-бота.`;
  } else {
    existingBlock =
      `<b>Противоположная сторона</b>\n` +
      `Деталей в БД нет; по снимку биржи противоположных открытых входов не видно.`;
  }

  const n = params.newPlaced;
  const newBlock = formatHedgeAuditSideHtml({
    title: 'Установлен новый вход',
    signalId: n.signalId,
    pair: n.pair,
    direction: n.direction,
    status: 'ORDERS_PLACED',
    entries: n.entries,
    entryIsRange: n.entryIsRange,
    stopLoss: n.stopLoss,
    takeProfits: n.takeProfits,
    leverage: n.leverage,
    orderUsd: n.orderUsd,
    capitalPercent: n.capitalPercent,
    source: n.source ?? null,
    extraNote: 'Проверьте на Bybit, что сторона выше не закрылась и не отменилась.',
  });

  return `${head}${existingBlock}\n\n${newBlock}`;
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
