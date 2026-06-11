import {
  API_PROCESS_ROLE_ALL,
  API_PROCESS_ROLE_API,
  API_PROCESS_ROLE_WORKER_BYBIT,
  API_PROCESS_ROLE_WORKER_USERBOT,
  API_PROCESS_ROLES,
  type ApiProcessRole,
} from './process-role.constants';

let cachedRole: ApiProcessRole | null = null;

export function resolveProcessRole(): ApiProcessRole {
  if (cachedRole) {
    return cachedRole;
  }
  const raw = String(process.env.API_PROCESS_ROLE ?? API_PROCESS_ROLE_ALL)
    .trim()
    .toLowerCase();
  cachedRole = (API_PROCESS_ROLES as readonly string[]).includes(raw)
    ? (raw as ApiProcessRole)
    : API_PROCESS_ROLE_ALL;
  return cachedRole;
}

export function isAllProcessRole(): boolean {
  return resolveProcessRole() === API_PROCESS_ROLE_ALL;
}

export function isApiProcessRole(): boolean {
  const role = resolveProcessRole();
  return role === API_PROCESS_ROLE_API || role === API_PROCESS_ROLE_ALL;
}

export function isDedicatedApiProcessRole(): boolean {
  return resolveProcessRole() === API_PROCESS_ROLE_API;
}

export function isWorkerUserbotProcessRole(): boolean {
  const role = resolveProcessRole();
  return role === API_PROCESS_ROLE_WORKER_USERBOT || role === API_PROCESS_ROLE_ALL;
}

export function isDedicatedWorkerUserbotProcessRole(): boolean {
  return resolveProcessRole() === API_PROCESS_ROLE_WORKER_USERBOT;
}

export function isWorkerBybitProcessRole(): boolean {
  const role = resolveProcessRole();
  return role === API_PROCESS_ROLE_WORKER_BYBIT || role === API_PROCESS_ROLE_ALL;
}

export function isDedicatedWorkerBybitProcessRole(): boolean {
  return resolveProcessRole() === API_PROCESS_ROLE_WORKER_BYBIT;
}

export function shouldRunTelegramBots(): boolean {
  return isApiProcessRole();
}

export function shouldRunUserbotMtproto(): boolean {
  return isWorkerUserbotProcessRole();
}

export function shouldRunWorkerQueue(): boolean {
  if (process.env.WORKER_QUEUE_ENABLED?.trim() === 'false') {
    return false;
  }
  return isWorkerBybitProcessRole();
}

export function shouldRunBybitPrivateWs(): boolean {
  return isWorkerBybitProcessRole();
}

export function shouldRunVkBot(): boolean {
  return isWorkerUserbotProcessRole();
}

export function shouldProxyBybitToWorker(): boolean {
  return isDedicatedApiProcessRole();
}

export function shouldProxyUserbotToWorker(): boolean {
  return isDedicatedApiProcessRole();
}

export function healthServiceLabel(): string {
  return resolveProcessRole();
}
