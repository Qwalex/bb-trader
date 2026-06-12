import { Logger } from '@nestjs/common';

import type { ApiProcessRole } from './process-role.constants';
import {
  healthServiceLabel,
  resolveProcessRole,
  shouldProxyBybitToWorker,
  shouldProxyUserbotToWorker,
  shouldRunBybitPrivateWs,
  shouldRunTelegramBots,
  shouldRunUserbotMtproto,
  shouldRunVkBot,
  shouldRunWorkerQueue,
} from './process-role.util';

export type ProcessCapabilities = {
  role: ApiProcessRole;
  telegramBots: boolean;
  userbotMtproto: boolean;
  workerQueue: boolean;
  bybitPrivateWs: boolean;
  vkBot: boolean;
  bybitHttpProxy: boolean;
  userbotHttpProxy: boolean;
};

export function getProcessCapabilities(): ProcessCapabilities {
  return {
    role: resolveProcessRole(),
    telegramBots: shouldRunTelegramBots(),
    userbotMtproto: shouldRunUserbotMtproto(),
    workerQueue: shouldRunWorkerQueue(),
    bybitPrivateWs: shouldRunBybitPrivateWs(),
    vkBot: shouldRunVkBot(),
    bybitHttpProxy: shouldProxyBybitToWorker(),
    userbotHttpProxy: shouldProxyUserbotToWorker(),
  };
}

export function logProcessRoleBootSummary(logger: Logger): void {
  const c = getProcessCapabilities();
  logger.log(
    `Process role=${c.role}: telegramBots=${c.telegramBots} userbotMtproto=${c.userbotMtproto} ` +
      `workerQueue=${c.workerQueue} bybitPrivateWs=${c.bybitPrivateWs} vkBot=${c.vkBot} ` +
      `bybitHttpProxy=${c.bybitHttpProxy} userbotHttpProxy=${c.userbotHttpProxy}`,
  );
}

export function healthPayload(): {
  status: string;
  service: string;
  capabilities: ProcessCapabilities;
} {
  return {
    status: 'ok',
    service: healthServiceLabel(),
    capabilities: getProcessCapabilities(),
  };
}
