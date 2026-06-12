import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../common/public.decorator';
import { isDedicatedWorkerUserbotProcessRole } from '../config/process-role.util';
import { TelegramUserbotService } from '../modules/telegram-userbot/telegram-userbot.service';
import type { UserbotGlobalConnectionState } from './internal-userbot.types';
import { InternalServiceGuard } from './internal-service.guard';

@ApiTags('Internal')
@Controller('internal/userbot')
@Public()
@UseGuards(InternalServiceGuard)
export class InternalUserbotController {
  constructor(private readonly userbot: TelegramUserbotService) {}

  @ApiOperation({ summary: 'Worker-UB: глобальный статус MTProto (internal token)' })
  @ApiOkResponse({ description: 'Состояние userbot' })
  @Get('connection')
  async connection(): Promise<UserbotGlobalConnectionState> {
    if (!isDedicatedWorkerUserbotProcessRole()) {
      return {
        connected: false,
        sessionConfigured: false,
        enabled: false,
        sessionOwnerUserId: null,
      };
    }
    return this.userbot.getGlobalConnectionState();
  }
}
