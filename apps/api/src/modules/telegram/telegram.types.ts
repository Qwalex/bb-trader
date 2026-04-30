import type { SignalDto } from '@repo/shared';

export type DraftPhase = 'collecting' | 'ready' | 'awaiting_source';

export type DraftSession = {
  phase: DraftPhase;
  updatedAtMs: number;
  userTurns: string[];
  signal?: SignalDto;
  partial?: Partial<SignalDto>;
  pendingSources?: string[];
};

export type ExternalConfirmationResult = {
  decision: 'confirmed' | 'rejected';
  ok: boolean;
  error?: string;
  signalId?: string;
  bybitOrderIds?: string[];
  actorUserId?: number;
};

export type ExternalConfirmationRequest = {
  requestId: string;
  cabinetId: string;
  ingestId: string;
  signal: SignalDto;
  rawMessage?: string;
  createdAt: number;
  onResult?: (result: ExternalConfirmationResult) => Promise<void> | void;
};
