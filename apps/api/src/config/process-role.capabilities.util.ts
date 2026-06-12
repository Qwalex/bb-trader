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
  userAuthConfigured: boolean;
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
    userAuthConfigured: hasUserAuthSecretConfigured(),
  };
}

export function hasUserAuthSecretConfigured(): boolean {
  return Boolean(
    process.env.AUTH_JWT_SECRET?.trim() || process.env.API_ACCESS_TOKEN?.trim(),
  );
}

export function logProcessRoleBootSummary(logger: Logger): void {
  const c = getProcessCapabilities();
  logger.log(
    `Process role=${c.role}: telegramBots=${c.telegramBots} userbotMtproto=${c.userbotMtproto} ` +
      `workerQueue=${c.workerQueue} bybitPrivateWs=${c.bybitPrivateWs} vkBot=${c.vkBot} ` +
      `bybitHttpProxy=${c.bybitHttpProxy} userbotHttpProxy=${c.userbotHttpProxy}`,
  );
  const needsUserAuth =
    c.role === 'all' ||
    c.role === 'api' ||
    c.role === 'worker-userbot' ||
    c.role === 'worker-bybit';
  if (needsUserAuth && !hasUserAuthSecretConfigured()) {
    logger.warn(
      'AUTH_JWT_SECRET or API_ACCESS_TOKEN is missing — user HTTP routes (incl. proxied) will return 401',
    );
  }
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
