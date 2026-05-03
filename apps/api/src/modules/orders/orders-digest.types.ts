/** Данные для ежедневного дайджеста в Telegram (без HTML). */

export type OrdersDigestClosedTradeRow = {
  pair: string;
  direction: string;
  status: string;
  realizedPnl: number | null;
  closedAt: Date | null;
  source: string | null;
};

export type OrdersDigestRollingWindow = {
  from: Date;
  to: Date;
  wins: number;
  losses: number;
  mixed: number;
  /** wins + losses — в знаменателе winrate как в дашборде */
  decided: number;
  winrate: number;
  totalPnl: number;
  trades: OrdersDigestClosedTradeRow[];
};

export type OrdersDigestHistoricalSlice = {
  wins: number;
  losses: number;
  decided: number;
  winrate: number;
  totalPnl: number;
};

export type OrdersDailyDigestModel = {
  rolling24h: OrdersDigestRollingWindow;
  /** Кумулятив по сделкам, закрытым строго раньше начала окна 24 ч */
  cumulativeBeforeWindow: OrdersDigestHistoricalSlice;
  overall: {
    winrate: number;
    wins: number;
    losses: number;
    totalClosed: number;
    totalPnl: number;
    openSignals: number;
  };
  /** Σ PnL закрытых за окно (совпадает с rolling24h.totalPnl при неизменной истории) */
  deltaPnlVsBefore: number;
  /** Текущий WR − WR по сделкам, закрытым до окна */
  deltaWinratePoints: number;
};
