import { fetchApiResponse } from '../../lib/api';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';

export function buildTelegramUserbotApiUrl(path: string): string {
  return path;
}

export function telegramUserbotApiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetchApiResponse(path, init, readActiveCabinetIdClient());
}
