export type MessageKind = 'signal' | 'close' | 'reentry' | 'result' | 'other';
export type UserbotFilterKind = 'signal' | 'close' | 'result' | 'reentry';
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
export type QrPhase =
  | 'idle'
  | 'starting'
  | 'waiting_scan'
  | 'authorized'
  | 'cancelled'
  | 'error';

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
  meta?: { replyToMessageId?: string };
  options?: ProcessIngestOptions;
};

export type ActiveSignalLookup = {
  id: string;
  workspaceId: string | null;
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
};

export type SourceMartingaleMap = Record<string, number>;
