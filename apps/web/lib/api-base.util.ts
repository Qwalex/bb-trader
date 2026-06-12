import { DEFAULT_INTERNAL_API_BASE } from './api.constants';

function trimUrl(raw: string | undefined): string {
  return String(raw ?? '').trim().replace(/\/+$/, '');
}

/** Публичный URL API (браузер / fallback для server fetch). */
export function getPublicApiBase(): string {
  return trimUrl(process.env.NEXT_PUBLIC_API_URL) || DEFAULT_INTERNAL_API_BASE;
}

/**
 * Server-side URL к Api: internal private network, иначе public.
 * На Railway: `http://${Api.RAILWAY_PRIVATE_DOMAIN}:${PORT}` (см. переменную на сервисе Api).
 */
export function getServerApiBase(): string {
  return trimUrl(process.env.API_INTERNAL_URL) || getPublicApiBase();
}

/** Кандидаты для server fetch: internal, затем public (если internal недоступен). */
export function getServerApiBaseCandidates(): string[] {
  const internal = trimUrl(process.env.API_INTERNAL_URL);
  const pub = getPublicApiBase();
  if (internal && internal !== pub) {
    return [internal, pub];
  }
  return [pub];
}

function isRetryableUpstreamError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN';
}

/** fetch с fallback internal → public для server-side BFF/SSR. */
export async function fetchServerApi(
  pathWithQuery: string,
  init: RequestInit,
): Promise<Response> {
  const bases = getServerApiBaseCandidates();
  let lastError: unknown;
  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i] ?? getPublicApiBase();
    const url = `${base}${pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`}`;
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      const hasFallback = i < bases.length - 1;
      if (!hasFallback || !isRetryableUpstreamError(error)) {
        throw error;
      }
    }
  }
  throw lastError ?? new Error('fetchServerApi failed');
}
