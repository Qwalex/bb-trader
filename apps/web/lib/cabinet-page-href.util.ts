/**
 * Добавляет или обновляет `cabinetId` в query внутренних маршрутов (Next `Link`).
 * Пути без ведущего `/` нормализуются. Без `cabinetId` возвращает путь без изменений.
 */
export function withCabinetPageHref(path: string, cabinetId: string | null | undefined): string {
  const id = String(cabinetId ?? '').trim();
  const raw = String(path ?? '').trim() || '/';
  const normalized = raw.startsWith('/') ? raw : `/${raw}`;
  if (!id) {
    return normalized;
  }
  try {
    const u = new URL(normalized, 'http://local.invalid');
    u.searchParams.set('cabinetId', id);
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    const hasQuery = normalized.includes('?');
    return `${normalized}${hasQuery ? '&' : '?'}cabinetId=${encodeURIComponent(id)}`;
  }
}
