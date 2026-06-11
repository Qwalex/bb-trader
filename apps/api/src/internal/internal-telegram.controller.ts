import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SignalDto } from '@repo/shared';

import { Public } from '../common/public.decorator';
import { isDedicatedApiProcessRole } from '../config/process-role.util';
import { CabinetContextService } from '../modules/cabinet/cabinet-context.service';
import { TelegramService } from '../modules/telegram';
import { InternalServiceGuard } from './internal-service.guard';
import {
  readWorkerUbInternalBaseUrl,
  workerInternalFetch,
} from './worker-http.util';

@ApiTags('Internal')
@Controller('internal/telegram')
@Public()
@UseGuards(InternalServiceGuard)
export class InternalTelegramController {
  constructor(
    private readonly telegram: TelegramService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  @ApiOperation({ summary: 'Worker-UB → Api: запрос confirm/reject в Telegram-боте' })
  @ApiOkResponse({ description: 'Запрос отправлен' })
  @Post('external-confirm-request')
  async externalConfirmRequest(
    @Body()
    body: {
      cabinetId?: string;
      ingestId?: string;
      signal?: SignalDto;
      rawMessage?: string;
    },
  ) {
    if (!isDedicatedApiProcessRole()) {
      return { ok: false, error: 'Telegram external confirm is only served on api role' };
    }
    const cabinetId = String(body.cabinetId ?? '').trim();
    const ingestId = String(body.ingestId ?? '').trim();
    if (!cabinetId || !ingestId || !body.signal) {
      return { ok: false, error: 'cabinetId, ingestId and signal are required' };
    }
    return this.cabinetContext.runWithCabinetAsync(cabinetId, async () => {
      const workerUb = readWorkerUbInternalBaseUrl();
      return this.telegram.requestExternalSignalConfirmation({
        ingestId,
        signal: body.signal!,
        rawMessage: body.rawMessage,
        onResult: workerUb
          ? async (result) => {
              await workerInternalFetch(workerUb, '/internal/ingest/after-external-confirm', {
                method: 'POST',
                body: { cabinetId, ingestId, result },
                cabinetId,
              }).catch(() => undefined);
            }
          : undefined,
      });
    });
  }
}
