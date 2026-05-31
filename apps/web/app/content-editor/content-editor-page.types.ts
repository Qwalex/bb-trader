export type ContentPostItem = {
  id: string;
  ingestId: string;
  sourceTitle: string | null;
  classification: 'analysis' | 'content';
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
