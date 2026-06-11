import type { FilterKind } from './filters-page.types';

export const FILTER_KINDS: FilterKind[] = [
  'signal',
  'close',
  'result',
  'reentry',
  'ad',
  'analysis',
  'promo',
  'content',
  'news',
  'ignore',
];

export const KIND_LABEL: Record<FilterKind, string> = {
  signal: 'Сигналы',
  close: 'Закрытие сделки (closed/cancel)',
  result: 'Результаты (TP/SL/отчеты)',
  reentry: 'Перезаход в позицию',
  ad: 'Реклама (VIP/каналы/подписки)',
  analysis: 'Анализ рынка',
  promo: 'Акции (розыгрыши/шоу/челенджи)',
  content: 'Контент (полезное/обучение)',
  news: 'Новости (факты/события/дайджесты)',
  ignore: 'Игнорировать (не отправлять в AI)',
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
  ad: {
    patterns: ['vip cornix', 'combo price', 'message to buy', 'lifetime validity'],
    examples: [
      `Binance Killers VIP Cornix
Combo Price $60 $50
Message to buy @seller`,
    ],
  },
  analysis: {
    patterns: ['update:', 'trading around', 'possible scenarios', 'stay tuned'],
    examples: [
      `#BTCUSDT UPDATE:
Bitcoin is trading around $75600 inside an uptrend channel.
Possible scenarios if price pumps from support...`,
    ],
  },
  promo: {
    patterns: ['розыгрыш', 'главный приз', 'челендж', 'промокод', 'giveaway'],
    examples: [
      `Трейдерское шоу
Осталось 2 дня — узнаем победителя главного приза.
Промокод на челендж — пишите в личку.`,
    ],
  },
  content: {
    patterns: ['совет', 'как торговать', 'money management', 'полезно знать'],
    examples: [
      `5 правил риск-менеджмента для фьючерсов:
1. Не рискуйте больше 1–2% на сделку
2. Всегда ставьте SL до входа
3. Не усредняйтесь против тренда`,
    ],
  },
  news: {
    patterns: ['breaking', 'just in', 'сегодня', 'объявил', 'запуск', 'листинг'],
    examples: [
      `SEC одобрила спот-ETF на Ethereum.
Торги начнутся завтра на основных биржах.`,
    ],
  },
  ignore: {
    patterns: ['free trial', 'subscribe', 'реклама'],
    examples: [
      `Открыт набор в VIP-группу.
Переходите по ссылке и оформляйте подписку.`,
    ],
  },
};

export function emptyFilterKindMap(): Record<FilterKind, never[]> {
  return {
    signal: [],
    close: [],
    result: [],
    reentry: [],
    ad: [],
    analysis: [],
    promo: [],
    content: [],
    news: [],
    ignore: [],
  };
}
