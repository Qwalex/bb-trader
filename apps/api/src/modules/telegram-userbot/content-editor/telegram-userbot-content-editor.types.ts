export type ContentPostClassification = 'analysis' | 'content';

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
};
