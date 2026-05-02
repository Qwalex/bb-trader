import { getApiAuthHeaders, getApiBase, withCabinetQuery } from '../../lib/api';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';

export function buildFiltersApiUrl(path: string): string {
  return `${getApiBase()}${withCabinetQuery(path, readActiveCabinetIdClient())}`;
}

export function filtersApiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(buildFiltersApiUrl(path), {
    ...init,
    headers: getApiAuthHeaders(init?.headers),
    cache: 'no-store',
  });
}
