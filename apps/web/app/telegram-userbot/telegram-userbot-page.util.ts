import { getApiAuthHeaders, getApiBase, withCabinetQuery } from '../../lib/api';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';

export function buildTelegramUserbotApiUrl(path: string): string {
  return `${getApiBase()}${withCabinetQuery(path, readActiveCabinetIdClient())}`;
}

export function telegramUserbotApiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(buildTelegramUserbotApiUrl(path), {
    ...init,
    headers: getApiAuthHeaders(init?.headers),
    cache: 'no-store',
  });
}
