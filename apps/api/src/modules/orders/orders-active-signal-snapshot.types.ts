/** Снимок активной сделки в БД (для аудита противоположной стороны при hedge). */
export type ActiveSignalTradeSnapshot = {
  id: string;
  pair: string;
  direction: string;
  status: string;
  entries: string;
  entryIsRange: boolean;
  stopLoss: number;
  takeProfits: string;
  leverage: number;
  orderUsd: number;
  capitalPercent: number;
  source: string | null;
  createdAt: Date;
};
