import type { SignalDto } from '@repo/shared';

export function toFixedPrice(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
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
  const targetLines = tps.map(
    (tp) =>
      `${toFixedPrice(tp)} (${calculateMovePercent({ from: entryMid, to: tp, direction })})`,
  );
  const targetsLine =
    targetLines.length > 0 ? targetLines.join(', ') : '—';

  return [
    `${direction === 'LONG' ? '🟢' : '🔴'} ${direction} ${pair}`,
    '',
    `⚡ Leverage: ${signal.leverage}x`,
    '',
    entryLabel,
    entryLine,
    '',
    '🛑 Stop Loss:',
    `${toFixedPrice(signal.stopLoss)} (${slPercent})`,
    '',
    `🎯 Targets: ${targetsLine}`,
  ].join('\n');
}

export function formatMirrorResultText(text: string): string {
  const cleaned = stripTelegramExportPrefix(text);
  return cleaned.slice(0, 3500);
}

export function formatMirrorCancelText(text: string): string {
  const cleaned = stripTelegramExportPrefix(text);
  return cleaned.slice(0, 3500);
}
