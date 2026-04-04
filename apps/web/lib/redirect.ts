import { withBasePath } from './auth';

export function normalizeRedirectTarget(
  raw: string | FormDataEntryValue | null | undefined,
  fallback = withBasePath('/'),
): string {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }
  return value;
}
