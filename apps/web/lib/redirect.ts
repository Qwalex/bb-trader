import { normalizeBasePath } from './auth';

/** Путь для NextResponse.redirect(new URL(path, request.url)) — с учётом basePath. */
export function normalizeRedirectTarget(
  raw: string | FormDataEntryValue | null | undefined,
  fallback?: string,
): string {
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  const defaultFallback = basePath ? `${basePath}/` : '/';
  const fb = fallback ?? defaultFallback;

  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value.startsWith('/') || value.startsWith('//')) {
    return fb;
  }
  // "/" при разборе через new URL('/', request.url) даёт корень хоста без basePath
  if (value === '/' && basePath) {
    return `${basePath}/`;
  }
  return value;
}
