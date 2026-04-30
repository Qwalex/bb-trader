export type BotStatus = {
  connected: boolean;
  enabled: boolean;
  useAiClassifier: boolean;
  requireConfirmation: boolean;
  pollMs?: number;
  pollingInFlight?: boolean;
  credentials: {
    apiIdConfigured: boolean;
    apiHashConfigured: boolean;
    sessionConfigured: boolean;
  };
  chatsTotal: number;
  chatsEnabled: number;
  qr: {
    phase: string;
    loginUrl?: string;
    qrDataUrl?: string;
    startedAt?: string;
    updatedAt?: string;
    error?: string;
  };
  balanceGuard?: {
    minBalanceUsd: number;
    balanceUsd: number | null;
    totalBalanceUsd: number | null;
    paused: boolean;
    reason?: string;
  };
};

export type UserbotChat = {
  id: string;
  chatId: string;
  title: string;
  username: string | null;
  enabled: boolean;
  sourcePriority: number;
  defaultLeverage: number | null;
  forcedLeverage?: number | null;
  leverageRangeMode?: 'min' | 'max' | 'mid' | null;
  minLeverage?: number | null;
  maxLeverage?: number | null;
  defaultEntryUsd: string | null;
  martingaleMultiplier: number | null;
  minLotBump?: boolean | null;
  tpSlStepStart?: string | null;
  tpSlStepRange?: number | null;
  openrouterCostTodayUsd?: number;
};

export type TodayMetrics = {
  dayStart: string;
  readMessages: number;
  signalsFound: number;
  signalsPlaced: number;
  noSignals: number;
  parseIncomplete: number;
  parseError: number;
  recent: Array<{
    id: string;
    chatId: string;
    messageId: string;
    text: string | null;
    aiRequest: string | null;
    aiResponse: string | null;
    isToday: boolean;
    classification: string;
    status: string;
    error: string | null;
    createdAt: string;
  }>;
};

export type TraceModalState = {
  chatId: string;
  messageId: string;
  request: string | null;
  response: string | null;
};
