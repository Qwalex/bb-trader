export type MessageKind = 'signal' | 'close' | 'reentry' | 'result' | 'other';
export type UserbotFilterKind = 'signal' | 'close' | 'result' | 'reentry' | 'ignore';

export type UserbotFilterExampleMatch = {
  kind: UserbotFilterKind;
  score: number;
  examplePreview: string;
  requiresQuote: boolean;
};

export type UserbotFilterPatternMatch = {
  kind: UserbotFilterKind;
  pattern: string;
  requiresQuote: boolean;
};

export type QrPhase = 'idle' | 'starting' | 'waiting_scan' | 'authorized' | 'cancelled' | 'error';

export type QrState = {
  phase: QrPhase;
  loginUrl?: string;
  qrDataUrl?: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
};

export type ProcessIngestOptions = {
  enforceBalanceGuard?: boolean;
  source?: 'realtime' | 'poll' | 'manual-reread' | 'manual-reread-all';
  telegramReceivedAt?: Date;
  ingestCreatedAt?: Date;
  enqueuedAtMs?: number;
  /** Повтор после правки: не слать whitelist/critical при повторной ошибке уровней. */
  suppressPlacementFailureExternalNotify?: boolean;
  /** Автоповтор после правки канала: не запрашивать TELEGRAM_USERBOT_REQUIRE_CONFIRMATION. */
  bypassConfirmationForAutoRetry?: boolean;
};

export type IngestProcessJob = {
  ingest: {
    id: string;
    chatId: string;
    messageId: string;
    signalHash: string | null;
    status: string;
  };
  text: string | null;
  textLen: number;
  meta?: { replyToMessageId?: string; signalExternalId?: string };
  options?: ProcessIngestOptions;
  route?: { id: string; cabinetId: string };
};

export type ActiveSignalLookup = {
  id: string;
  /** Кабинет сигнала — для ключей stale-reconcile при отсутствии ALS. */
  cabinetId: string | null;
  pair: string;
  direction: string;
  entries: string;
  stopLoss: number;
  takeProfits: string;
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
  source: string | null;
  sourceChatId: string | null;
  sourceMessageId: string | null;
  signalExternalId?: string | null;
};

export type OpenrouterSpendPeriod = 'day' | '3d' | 'week' | 'month' | 'year';

export type ScopedChatOverride = {
  chatId: string;
  enabled: boolean;
  sourcePriority: number;
  defaultLeverage: number | null;
  forcedLeverage: number | null;
  leverageRangeMode: string | null;
  minLeverage: number | null;
  maxLeverage: number | null;
  defaultEntryUsd: string | null;
  minLotBump: boolean | null;
  martingaleMultiplier: number | null;
  tpSlStepStart: string | null;
  tpSlStepRange: number | null;
};
