export type FilterKind = 'signal' | 'close' | 'result' | 'reentry';
export type FilterItem = {
  id: string;
  groupName: string;
  kind: FilterKind;
  example: string;
  requiresQuote: boolean;
  createdAt: string;
};

export type PatternItem = {
  id: string;
  groupName: string;
  kind: FilterKind;
  pattern: string;
  requiresQuote: boolean;
  createdAt: string;
};

export const KIND_LABEL: Record<FilterKind, string> = {
  signal: 'Сигналы',
  close: 'Закрытие сделки (closed/cancel)',
  result: 'Результаты (TP/SL/отчеты)',
  reentry: 'Перезаход в позицию',
};

export const SECTION_TITLE_STYLE = {
  marginBottom: '0.7rem',
  display: 'inline-block',
  padding: '0.3rem 0.55rem',
  borderRadius: 8,
  background: 'rgba(0, 200, 255, 0.12)',
  border: '1px solid rgba(0, 200, 255, 0.28)',
  color: 'var(--accent)',
} as const;

export const KIND_TITLE_STYLE = {
  fontSize: '0.8rem',
  display: 'inline-block',
  marginBottom: '0.25rem',
  padding: '0.15rem 0.45rem',
  borderRadius: 999,
  background: 'rgba(255, 255, 255, 0.06)',
  color: 'var(--foreground)',
} as const;

export const SAMPLE_HINTS: Record<
  FilterKind,
  {
    patterns: string[];
    examples: string[];
  }
> = {
  signal: {
    patterns: ['entry:', 'stop loss:', 'targets:', 'long'],
    examples: [
      `#ETHUSDT LONG

Entry: 2450-2470
Stop Loss: 2390
Targets: 2520, 2580, 2640`,
    ],
  },
  close: {
    patterns: ['closed!', 'trade closed', 'manual close', 'закрыт'],
    examples: [
      `#TRUMPUSDT - Closed! 🔘
Trade closed with 15.6938% profit.`,
    ],
  },
  result: {
    patterns: ['tp', 'target reached', 'profit:', 'sl hit', 'duration:'],
    examples: [
      `#POLUSDT - 🚨 Target 2 reached
💸 Profit collected 22.2952%
⏰ Posted: 5 hr 38 min Ago`,
    ],
  },
  reentry: {
    patterns: ['reentry', 'перезаход', 'add entry', 'добор'],
    examples: [
      `Перезаход по #BTCUSDT
Новый вход: 64200
SL тот же`,
    ],
  },
};
