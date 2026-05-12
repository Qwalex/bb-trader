import { ACTIVE_CABINET_STORAGE_KEY } from './api.constants';

export function readActiveCabinetIdClient(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const fromQuery = new URLSearchParams(window.location.search).get('cabinetId')?.trim() ?? '';
  if (fromQuery) {
    return fromQuery;
  }
  const fromStorage = window.localStorage.getItem(ACTIVE_CABINET_STORAGE_KEY)?.trim() ?? '';
  if (fromStorage) {
    return fromStorage;
  }
  const fromCookie = document.cookie
    .split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith('cabinet_id='))
    ?.split('=')[1];
  if (!fromCookie) return '';
  try {
    return decodeURIComponent(fromCookie).trim();
  } catch {
    return fromCookie.trim();
  }
}
