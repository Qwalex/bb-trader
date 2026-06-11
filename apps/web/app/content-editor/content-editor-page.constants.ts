import type { ContentCollectKind } from '@repo/shared';

export const CLASSIFICATION_LABEL: Record<ContentCollectKind, string> = {
  analysis: 'Анализ',
  content: 'Контент',
  news: 'Новости',
  other: 'Другое',
};

export const STATUS_LABEL: Record<'draft' | 'published', string> = {
  draft: 'Черновик',
  published: 'Опубликован',
};

export const COLLECT_KIND_OPTIONS: ContentCollectKind[] = [
  'analysis',
  'content',
  'news',
  'other',
];

export const FILTER_CLASSIFICATION_OPTIONS: Array<ContentCollectKind | 'all'> = [
  'all',
  'analysis',
  'content',
  'news',
  'other',
];

export const FILTER_STATUS_OPTIONS = [
  { value: '', label: 'Любой статус' },
  { value: 'draft', label: 'Черновик' },
  { value: 'published', label: 'Опубликован' },
] as const;
