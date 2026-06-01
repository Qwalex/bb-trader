import { ENV_FALLBACK } from './settings.constants';

/** Синхронный fallback для list() — без N вызовов get()/getMany(). */
export function resolveSettingFallbackSync(
  key: string,
  configGet: (key: string) => string | undefined,
): string | undefined {
  const fromConfig = configGet(key);
  if (fromConfig !== undefined && fromConfig !== '') {
    return fromConfig;
  }
  const fromProcess = process.env[key];
  if (fromProcess !== undefined && fromProcess !== '') {
    return fromProcess;
  }
  return ENV_FALLBACK[key];
}
