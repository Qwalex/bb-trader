const TRADE_SIGNAL_EVENT_TITLES_RU: Record<string, string> = {
  BYBIT_TRADE_DELETE_CLEANUP_PENDING: 'Очистка Bybit: в процессе',
  BYBIT_TRADE_DELETE_CLEANUP_FAILED: 'Очистка Bybit: ошибка',
  BYBIT_TRADE_DELETE_CLEANUP_SUCCESS: 'Очистка Bybit: готово',
  BYBIT_CLOSE_PENDING: 'Закрытие на Bybit ожидает подтверждения',
  BYBIT_CLOSE_FAILED: 'Ошибка закрытия на Bybit',
  BYBIT_CLOSE_SUCCESS: 'Сделка закрыта на Bybit',
  TP_SL_STEPPED: 'SL подтянут после TP',
  TELEGRAM_LINK_UPDATED: 'Привязка к сообщению Telegram',
  SIGNAL_CANCELLED_BY_SOURCE_PRIORITY: 'Сигнал отменён (приоритет источника)',
  REENTRY_UPDATED: 'Перезаход обновил параметры',
  REENTRY_REPLACED_OLD: 'Старый сигнал заменён',
  REENTRY_REPLACED_NEW: 'Создан новый сигнал',
  CANCELLED_BY_CHAT: 'Отмена в чате',
  USERBOT_RESULT_WITHOUT_ENTRY: 'Результат без входа',
  USERBOT_RESULT_WITHOUT_ENTRY_CANCELLED: 'Отмена ордеров: result без входа',
};

export function tradeSignalEventTitleRu(type: string): string {
  return TRADE_SIGNAL_EVENT_TITLES_RU[type] ?? type;
}
