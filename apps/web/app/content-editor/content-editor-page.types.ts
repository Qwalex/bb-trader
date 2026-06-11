import type { ContentCollectKind } from '@repo/shared';

export type ContentPostItem = {
  id: string;
  ingestId: string;
  sourceChatId: string;
  sourceMessageId: string;
  sourceTitle: string | null;
  classification: ContentCollectKind;
  originalText: string;
  editedText: string | null;
  displayText: string;
  status: 'draft' | 'published';
  publishedAt: string | null;
  createdAt: string;
  publicationCount: number;
};

export type PublishGroupItem = {
  id: string;
  title: string;
  chatId: string;
  enabled: boolean;
  contentPublishEnabled?: boolean;
};

export type ContentEditorFiltersState = {
  classification: ContentCollectKind | 'all';
  status: '' | 'draft' | 'published';
  sourceChatId: string;
  q: string;
  from: string;
  to: string;
};

export type ContentGenerationPresetItem = {
  id: string;
  name: string;
  enabled: boolean;
  sourceKinds: string[];
  sourceGroupIds: string[];
  aiInstruction: string;
  outputStyle: string | null;
  dailyLimit: number;
  scheduleCron: string | null;
  autoPublish: boolean;
  targetGroupIds: string[];
  lastRunAt: string | null;
  lastPublishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ContentGenerationRunItem = {
  id: string;
  presetId: string;
  status: string;
  sourcePostIds: string[];
  resultPostId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type CollectSettingsState = {
  kinds: string[];
};
