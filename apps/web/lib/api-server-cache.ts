import { cache } from 'react';

import { fetchJson } from './api';

/** Дедуп SSR-fetch в рамках одного RSC-запроса (layout + page). */
export const fetchJsonCached = cache(
  <T,>(path: string, init?: RequestInit, cabinetId?: string | null): Promise<T> =>
    fetchJson<T>(path, init, cabinetId),
);
