export type ExternalConfirmResultPayload = {
  decision?: 'confirmed' | 'rejected';
  ok?: boolean;
  error?: string;
  placeErrorCode?: string;
  signalId?: string;
  bybitOrderIds?: string[];
  actorUserId?: number;
};
