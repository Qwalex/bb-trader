export type ApplyTpSlManuallyResult = {
  ok: boolean;
  error?: string;
  /** Синхронизация статусов ордеров с Bybit выполнена */
  synced: boolean;
  /** Нет открытых ENTRY/DCA после синка */
  entriesComplete: boolean;
  /** Число активных TP-ордеров в БД после попытки */
  liveTpCount: number;
  /** SL на позиции на бирже (по snapshot) */
  positionHasSl: boolean;
  /** Размер позиции на бирже (base coin), 0 если нет */
  positionSize: number;
  /** TP/SL считаются полными (как fast-apply) */
  complete: boolean;
  message: string;
};
