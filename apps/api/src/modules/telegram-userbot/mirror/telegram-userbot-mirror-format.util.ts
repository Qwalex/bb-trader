import type { SignalDto } from '@repo/shared';

export function toFixedPrice(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

/** Цена для mirror-событий (TP/вход): больше знаков для дешёвых монет. */
export function formatMirrorDisplayPrice(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  let digits = 2;
  if (abs < 0.0001) digits = 8;
  else if (abs < 0.01) digits = 6;
  else if (abs < 1) digits = 5;
  else if (abs < 100) digits = 4;
  const trimmed = value.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return trimmed.length > 0 ? trimmed : '0';
}

export function formatMirrorTpFilledText(params: {
  pair: string;
  tpNumber: number;
  price?: number | null;
}): string {
  const pair = params.pair.toUpperCase();
  const tpNumber = Math.max(1, Math.trunc(params.tpNumber));
  const lines = [`🎯 ${pair} · Take Profit ${tpNumber} достигнут`];
  if (params.price != null && Number.isFinite(params.price) && params.price > 0) {
    lines.push(`💰 Цена: ${formatMirrorDisplayPrice(params.price)}`);
  }
  return lines.join('\n');
}

export function formatMirrorEntryFilledText(params: {
  pair: string;
  price?: number | null;
}): string {
  const pair = params.pair.toUpperCase();
  const lines = [`📥 ${pair} · Вход в позицию`];
  if (params.price != null && Number.isFinite(params.price) && params.price > 0) {
    lines.push(`💰 Цена: ${formatMirrorDisplayPrice(params.price)}`);
  }
  return lines.join('\n');
}

export function normalizeDirection(direction: SignalDto['direction']): 'LONG' | 'SHORT' {
  return direction === 'short' ? 'SHORT' : 'LONG';
}

export function calculateMovePercent(params: {
  from: number;
  to: number;
  direction: 'LONG' | 'SHORT';
}): string {
  if (!Number.isFinite(params.from) || params.from === 0 || !Number.isFinite(params.to)) {
    return '0.00%';
  }
  const raw =
    params.direction === 'LONG'
      ? ((params.to - params.from) / params.from) * 100
      : ((params.from - params.to) / params.from) * 100;
  return `${Math.abs(raw).toFixed(2)}%`;
}

export function stripTelegramExportPrefix(text: string): string {
  const lines = text.replace(/\r/g, '').split('\n');
  if (lines.length === 0) {
    return '';
  }
  const firstLine = lines[0];
  if (firstLine === undefined) {
    return lines.join('\n').trim();
  }
  lines[0] = firstLine
    .replace(/^\[\d{2}\.\d{2}\.\d{4}\s+\d{1,2}:\d{2}\]\s*[^:]+:\s*/u, '')
    .trimStart();
  return lines.join('\n').trim();
}

export function formatMirrorSignalText(
  signal: SignalDto,
  _sourceChatTitle?: string,
): string {
  void _sourceChatTitle;
  const direction = normalizeDirection(signal.direction);
  const pair = signal.pair.toUpperCase();
  const entries = [...signal.entries].filter((e) => Number.isFinite(e) && e > 0);
  const tps = [...signal.takeProfits].filter(Number.isFinite);
  const entryLow = entries[0] ?? 0;
  const entryHigh = entries[entries.length - 1] ?? entryLow;
  const entryMid = (entryLow + entryHigh) / 2;
  const entryLowFmt = toFixedPrice(entryLow);
  const entryHighFmt = toFixedPrice(entryHigh);
  const entryIsSingle = entries.length === 0 || entries.length === 1 || entryLowFmt === entryHighFmt;
  const entryLine =
    entries.length === 0
      ? '— (цена не получена)'
      : entryIsSingle
        ? entryLowFmt
        : `${entryLowFmt} - ${entryHighFmt}`;
  const entryLabel =
    entries.length > 1 && !entryIsSingle ? '💰 Entry Range:' : '💰 Entry:';
  const slPercent = calculateMovePercent({
    from: entryMid,
    to: signal.stopLoss,
    direction,
  });
  const tpLines = tps.map(
    (tp, index) =>
      `TP${index + 1}: ${toFixedPrice(tp)} (${calculateMovePercent({ from: entryMid, to: tp, direction })})`,
  );

  const lines = [
    `${direction === 'LONG' ? '🟢' : '🔴'} ${direction} ${pair}`,
    `⚡️ Leverage: ${signal.leverage}x`,
    `${entryLabel} ${entryLine}`,
    `🛑 Stop Loss: ${toFixedPrice(signal.stopLoss)} (${slPercent})`,
    tpLines.length > 0 ? '🎯 Targets:' : '🎯 Targets: —',
    ...tpLines,
  ];

  return lines.join('\n');
}

export function formatMirrorResultText(text: string): string {
  const cleaned = stripTelegramExportPrefix(text);
  return cleaned.slice(0, 3500);
}

export function formatMirrorCancelText(text: string): string {
  const cleaned = stripTelegramExportPrefix(text);
  return cleaned.slice(0, 3500);
}
