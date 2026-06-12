import { fetchApiResponse } from '../../lib/api';
import { readActiveCabinetIdClient } from '../../lib/cabinet-client.util';

export function buildFiltersApiUrl(path: string): string {
  return path;
}

export function filtersApiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetchApiResponse(path, init, readActiveCabinetIdClient());
}
