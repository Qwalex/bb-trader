import { fetchApiResponse } from '../../lib/api';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';

export function contentEditorApiFetch(path: string, init?: RequestInit) {
  return fetchApiResponse(path, init, readActiveCabinetIdClient());
}

export const CLASSIFICATION_LABEL: Record<'analysis' | 'content', string> = {
  analysis: 'Анализ',
  content: 'Контент',
};

export const STATUS_LABEL: Record<'draft' | 'published', string> = {
  draft: 'Черновик',
  published: 'Опубликован',
};
