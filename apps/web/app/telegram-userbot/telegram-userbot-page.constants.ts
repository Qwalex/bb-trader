/** Фоновый опрос на странице userbot: не ниже ~3–4 с, чтобы не забивать API/Railway. */
export const TELEGRAM_USERBOT_PAGE_POLL_MS_WHEN_CONNECTED = 5000;
/** Только обновление QR (userbot ещё не подключён) — без metrics/today. */
export const TELEGRAM_USERBOT_PAGE_POLL_MS_QR_ONLY = 4500;

export const INGEST_CLASSIFICATION_LABEL: Record<string, string> = {
  signal: 'Сигнал',
  result: 'Результат',
  ad: 'Реклама',
  analysis: 'Анализ',
  promo: 'Акция',
  content: 'Контент',
  news: 'Новости',
  close: 'Закрытие',
  reentry: 'Перезаход',
  other: 'Другое',
};

export function ingestClassificationLabel(classification: string): string {
  return INGEST_CLASSIFICATION_LABEL[classification] ?? classification;
}
