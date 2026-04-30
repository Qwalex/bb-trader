export type Row = { key: string; value: string };

export type PendingChange = {
  key: string;
  label: string;
  before: string;
  after: string;
};
