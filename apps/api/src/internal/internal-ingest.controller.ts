import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/public.decorator';
import { isDedicatedWorkerUserbotProcessRole } from '../config/process-role.util';
import { TelegramUserbotIngestAfterConfirmService } from '../modules/telegram-userbot/ingest/telegram-userbot-ingest-after-confirm.service';
import { InternalServiceGuard } from './internal-service.guard';

@ApiTags('Internal')
@Controller('internal/ingest')
@Public()
@UseGuards(InternalServiceGuard)
export class InternalIngestController {
  constructor(private readonly afterConfirm: TelegramUserbotIngestAfterConfirmService) {}

  @ApiOperation({ summary: 'Api → Worker-UB: side-effects после confirm/reject' })
  @ApiOkResponse({ description: 'Обработано' })
  @Post('after-external-confirm')
  async afterExternalConfirm(
    @Body()
    body: {
      cabinetId?: string;
      ingestId?: string;
      result?: {
        decision?: 'confirmed' | 'rejected';
        ok?: boolean;
        error?: string;
        placeErrorCode?: string;
        signalId?: string;
        bybitOrderIds?: string[];
        actorUserId?: number;
      };
    },
  ) {
    if (!isDedicatedWorkerUserbotProcessRole()) {
      return { ok: false, error: 'Ingest after-confirm is only served on worker-userbot role' };
    }
    const cabinetId = String(body.cabinetId ?? '').trim();
    const ingestId = String(body.ingestId ?? '').trim();
    if (!cabinetId || !ingestId || !body.result) {
      return { ok: false, error: 'cabinetId, ingestId and result are required' };
    }
    return this.afterConfirm.handleAfterExternalConfirm({
      cabinetId,
      ingestId,
      result: body.result,
    });
  }
}
