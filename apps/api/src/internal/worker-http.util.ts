import { formatError } from '../common/format-error';

export function readWorkerInternalToken(): string {
  return String(process.env.WORKER_INTERNAL_TOKEN ?? '').trim();
}

export function readWorkerBybitInternalBaseUrl(): string {
  return String(process.env.WORKER_BYBIT_INTERNAL_URL ?? '').trim().replace(/\/+$/, '');
}

export function readWorkerUbInternalBaseUrl(): string {
  return String(process.env.WORKER_UB_INTERNAL_URL ?? '').trim().replace(/\/+$/, '');
}

export function readApiInternalBaseUrl(): string {
  return String(process.env.API_INTERNAL_URL ?? '').trim().replace(/\/+$/, '');
}

export type WorkerHttpOptions = {
  method?: string;
  body?: unknown;
  cabinetId?: string | null;
  query?: Record<string, string | undefined>;
};

export async function workerInternalFetch(
  baseUrl: string,
  path: string,
  options: WorkerHttpOptions = {},
): Promise<Response> {
  const token = readWorkerInternalToken();
  if (!token) {
    throw new Error('WORKER_INTERNAL_TOKEN is not configured');
  }
  if (!baseUrl) {
    throw new Error('Worker internal base URL is not configured');
  }
  const url = new URL(path.startsWith('/') ? path : `/${path}`, `${baseUrl}/`);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value != null && String(value).trim() !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const headers = new Headers({
    'X-Internal-Token': token,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  });
  const cabinetId = String(options.cabinetId ?? '').trim();
  if (cabinetId) {
    headers.set('x-cabinet-id', cabinetId);
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(options.body);
  }
  return fetch(url.toString(), {
    method: options.method ?? (body != null ? 'POST' : 'GET'),
    headers,
    body,
    cache: 'no-store',
  });
}

export async function workerInternalFetchJson<T>(
  baseUrl: string,
  path: string,
  options: WorkerHttpOptions = {},
): Promise<T> {
  const res = await workerInternalFetch(baseUrl, path, options);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`worker internal ${path}: ${res.status} ${text || res.statusText}`);
  }
  if (!text.trim()) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`worker internal ${path}: invalid JSON (${formatError(e)})`);
  }
}
