export type SignalDirection = 'long' | 'short';

/**
 * Единый вид пары для БД и сравнения с Bybit (пробелы, BTC-USDT / BTC/USDT → BTCUSDT).
 */
export function normalizeTradingPair(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s\-_/]/g, '');
}

/** Parsed trading signal (contract between Transcript and Bybit). */
export interface SignalDto {
  pair: string;
  direction: SignalDirection;
  /** Цены входов: первый — основной, остальные — DCA; номинал на Bybit: 50% / остальное поровну на DCA */
  entries: number[];
  /**
   * true — entries из двух чисел задают одну зону [low, high] (не DCA). Исполнение: см. BybitService.
   */
  entryIsRange?: boolean;
  stopLoss: number;
  /** TP levels; position split equally */
  takeProfits: number[];
  leverage: number;
  /**
   * Номинал позиции в USDT (совокупно по всем входам).
   * Если 0 — используется capitalPercent от баланса (legacy).
   * Если оба нулевые/не заданы — в ордере подставляется номинал из настроек (DEFAULT_ORDER_USD, иначе 10).
   */
  orderUsd: number;
  /** Доля баланса в % при orderUsd === 0; 1–100 — маржа (номинал × плечо); >100 — номинал = баланс×(pct/100) */
  capitalPercent: number;
  /**
   * Откуда взят сигнал: группа, канал, приложение (для сравнения качества источников).
   * Не тип контента (text/image/audio).
   */
  source?: string;
}

export type ContentKind = 'text' | 'image' | 'audio';

export interface TranscriptError {
  ok: false;
  error: string;
  details?: string;
}

export interface TranscriptSuccess {
  ok: true;
  signal: SignalDto;
}

/**
 * Не хватает полей для ордера — нужны уточнения в чате.
 * partial накапливается между сообщениями до ok: true.
 */
export interface TranscriptIncomplete {
  ok: 'incomplete';
  partial: Partial<SignalDto>;
  /** Имена/ключи отсутствующих полей (для логов) */
  missing: string[];
  /** Текст боту: что спросить у пользователя */
  prompt: string;
}

export type TranscriptResult =
  | TranscriptError
  | TranscriptSuccess
  | TranscriptIncomplete;

export type OrderKind = 'ENTRY' | 'DCA' | 'TP' | 'SL';

export type SignalStatus =
  | 'PARSED'
  | 'ORDERS_PLACED'
  | 'FAILED'
  | 'CLOSED_WIN'
  | 'CLOSED_LOSS'
  | 'CLOSED_MIXED'
  | 'OPEN';

export {
  TRADE_SIGNAL_NOTIFY_EVENT_OPTIONS,
  parseTradeSignalNotifyEventFilter,
  type TradeSignalNotifyEventId,
} from './trade-signal-events';
