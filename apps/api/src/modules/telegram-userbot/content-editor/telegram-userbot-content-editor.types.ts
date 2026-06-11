export type ContentPostClassification = 'analysis' | 'content' | 'news' | 'other';

export type ContentPostStatus = 'draft' | 'published';

export type ContentPostDto = {
  id: string;
  ingestId: string;
  sourceChatId: string;
  sourceMessageId: string;
  sourceTitle: string | null;
  classification: ContentPostClassification;
  originalText: string;
  editedText: string | null;
  displayText: string;
  status: ContentPostStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  publicationCount: number;
  presetId?: string | null;
};

export type ContentGenerationPresetDto = {
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

export type ContentGenerationRunDto = {
  id: string;
  presetId: string;
  status: string;
  sourcePostIds: string[];
  resultPostId: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type ContentCollectSettingsDto = {
  kinds: string[];
};
