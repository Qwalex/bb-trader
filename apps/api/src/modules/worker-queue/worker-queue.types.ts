export const WORK_QUEUE_EXECUTION = 'execution';
export const WORK_QUEUE_RECONCILE = 'reconcile';
export const WORK_QUEUE_NOTIFICATIONS = 'notifications';

export type WorkQueueName =
  | typeof WORK_QUEUE_EXECUTION
  | typeof WORK_QUEUE_RECONCILE
  | typeof WORK_QUEUE_NOTIFICATIONS;

export type WorkQueuePayload =
  | {
      type: 'poll-cabinet';
      cabinetId: string;
      reason?: string;
    }
  | {
      type: 'recalc-closed-pnl';
      jobId: string;
      dryRun: boolean;
      limit: number;
      cabinetId?: string | null;
    }
  | {
      type: 'bybit-ws-reconcile';
      cabinetId: string;
      symbol?: string;
    }
  | {
      type: 'notify-trade-cancelled';
      cabinetId?: string | null;
      signalIds: string[];
      reason: string;
    };

