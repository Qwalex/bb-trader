import { BadRequestException } from '@nestjs/common';

import { shouldRunUserbotMtproto } from '../../../config/process-role.util';

const USERBOT_MTProto_HOST_ERROR =
  'MTProto userbot доступен только в процессе Worker-UB (API_PROCESS_ROLE=worker-userbot).';

export function assertUserbotMtprotoProcessRole(): void {
  if (!shouldRunUserbotMtproto()) {
    throw new BadRequestException(USERBOT_MTProto_HOST_ERROR);
  }
}

export function userbotMtprotoHostError(): string {
  return USERBOT_MTProto_HOST_ERROR;
}
