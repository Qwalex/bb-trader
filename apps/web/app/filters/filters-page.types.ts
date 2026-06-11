export type FilterKind =
  | 'signal'
  | 'close'
  | 'result'
  | 'reentry'
  | 'ad'
  | 'analysis'
  | 'promo'
  | 'content'
  | 'news'
  | 'ignore';

export type FilterItem = {
  id: string;
  groupName: string;
  kind: FilterKind;
  example: string;
  requiresQuote: boolean;
  createdAt: string;
};

export type PatternItem = {
  id: string;
  groupName: string;
  kind: FilterKind;
  pattern: string;
  requiresQuote: boolean;
  createdAt: string;
};
