import { fetchApiResponse } from '../../lib/api';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';
import type { ContentEditorFiltersState } from './content-editor-page.types';

export function contentEditorApiFetch(path: string, init?: RequestInit) {
  return fetchApiResponse(path, init, readActiveCabinetIdClient());
}

export function buildPostsQuery(filters: ContentEditorFiltersState, cursor?: string | null): string {
  const params = new URLSearchParams();
  if (filters.classification !== 'all') {
    params.set('classification', filters.classification);
  }
  if (filters.status) params.set('status', filters.status);
  if (filters.sourceChatId.trim()) params.set('sourceChatId', filters.sourceChatId.trim());
  if (filters.q.trim()) params.set('q', filters.q.trim());
  if (filters.from.trim()) params.set('from', filters.from.trim());
  if (filters.to.trim()) params.set('to', filters.to.trim());
  if (cursor) params.set('cursor', cursor);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export { CLASSIFICATION_LABEL, STATUS_LABEL } from './content-editor-page.constants';
