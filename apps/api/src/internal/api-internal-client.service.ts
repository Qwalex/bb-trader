import { Injectable } from '@nestjs/common';
import type { SignalDto } from '@repo/shared';

import { isDedicatedWorkerUserbotProcessRole } from '../config/process-role.util';
import {
  readApiInternalBaseUrl,
  workerInternalFetchJson,
} from '../internal/worker-http.util';

@Injectable()
export class ApiInternalClientService {
  isEnabled(): boolean {
    return isDedicatedWorkerUserbotProcessRole() && Boolean(readApiInternalBaseUrl());
  }

  async requestExternalConfirm(params: {
    cabinetId: string;
    ingestId: string;
    signal: SignalDto;
    rawMessage?: string;
  }): Promise<{ ok: boolean; requestId?: string; deliveredTo: number; error?: string }> {
    const base = readApiInternalBaseUrl();
    if (!base) {
      return { ok: false, deliveredTo: 0, error: 'API_INTERNAL_URL is not configured' };
    }
    return workerInternalFetchJson(base, '/internal/telegram/external-confirm-request', {
      method: 'POST',
      body: params,
      cabinetId: params.cabinetId,
    });
  }
}
