/**
 * Типы событий сделки (SignalEvent), по которым можно слать уведомления в Telegram.
 * Не включает типы, которые и так дублируют отдельные сообщения (отмена сделки, result без входа).
 */
export const TRADE_SIGNAL_NOTIFY_EVENT_OPTIONS = [
  { id: 'TP_SL_STEPPED', labelRu: 'SL подтянут после TP' },
  { id: 'BYBIT_CLOSE_SUCCESS', labelRu: 'Сделка закрыта на Bybit' },
  { id: 'BYBIT_CLOSE_PENDING', labelRu: 'Закрытие ждёт подтверждения Bybit' },
  { id: 'BYBIT_CLOSE_FAILED', labelRu: 'Ошибка закрытия на Bybit' },
  {
    id: 'BYBIT_TRADE_DELETE_CLEANUP_PENDING',
    labelRu: 'Очистка Bybit (удаление сделки): в процессе',
  },
  {
    id: 'BYBIT_TRADE_DELETE_CLEANUP_FAILED',
    labelRu: 'Очистка Bybit: ошибка',
  },
  { id: 'TELEGRAM_LINK_UPDATED', labelRu: 'Привязка к сообщению Telegram' },
  {
    id: 'SIGNAL_CANCELLED_BY_SOURCE_PRIORITY',
    labelRu: 'Сигнал отменён (приоритет источника)',
  },
  { id: 'REENTRY_UPDATED', labelRu: 'Перезаход: обновлены SL/TP' },
  { id: 'REENTRY_REPLACED_OLD', labelRu: 'Перезаход: старый сигнал заменён' },
  { id: 'REENTRY_REPLACED_NEW', labelRu: 'Перезаход: создан новый сигнал' },
  { id: 'CANCELLED_BY_CHAT', labelRu: 'Отмена в чате (closed/cancel)' },
  {
    id: 'USERBOT_RESULT_WITHOUT_ENTRY_CANCELLED',
    labelRu: 'Отмена ордеров: result без входа',
  },
] as const;

export type TradeSignalNotifyEventId =
  (typeof TRADE_SIGNAL_NOTIFY_EVENT_OPTIONS)[number]['id'];

/**
 * JSON-массив id в настройке TELEGRAM_NOTIFY_TRADE_EVENT_TYPES:
 * - пустая строка / не задано → все типы из каталога;
 * - `[]` → ни одного;
 * - `["TP_SL_STEPPED", ...]` → только перечисленные.
 */
export function parseTradeSignalNotifyEventFilter(
  raw: string | undefined | null,
):
  | { mode: 'all' }
  | { mode: 'none' }
  | { mode: 'only'; types: Set<string> } {
  const t = String(raw ?? '').trim();
  if (!t) {
    return { mode: 'all' };
  }
  try {
    const parsed = JSON.parse(t) as unknown;
    if (!Array.isArray(parsed)) {
      return { mode: 'all' };
    }
    if (parsed.length === 0) {
      return { mode: 'none' };
    }
    return { mode: 'only', types: new Set(parsed.map(String)) };
  } catch {
    return { mode: 'all' };
  }
}
