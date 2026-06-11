export const API_PROCESS_ROLE_ALL = 'all';
export const API_PROCESS_ROLE_API = 'api';
export const API_PROCESS_ROLE_WORKER_USERBOT = 'worker-userbot';
export const API_PROCESS_ROLE_WORKER_BYBIT = 'worker-bybit';

export type ApiProcessRole =
  | typeof API_PROCESS_ROLE_ALL
  | typeof API_PROCESS_ROLE_API
  | typeof API_PROCESS_ROLE_WORKER_USERBOT
  | typeof API_PROCESS_ROLE_WORKER_BYBIT;

export const API_PROCESS_ROLES: readonly ApiProcessRole[] = [
  API_PROCESS_ROLE_ALL,
  API_PROCESS_ROLE_API,
  API_PROCESS_ROLE_WORKER_USERBOT,
  API_PROCESS_ROLE_WORKER_BYBIT,
] as const;
