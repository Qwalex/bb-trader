export function normalizeBasePath(raw: string | undefined): string {
  const t = (raw ?? '').trim();
  if (!t || t === '/') return '';
  return (t.startsWith('/') ? t : `/${t}`).replace(/\/+$/, '');
}

/** Не использовать с `next/link` и `redirect()` — у них basePath уже учитывается. */
export function withBasePath(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }
  return `${normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH)}${path}`;
}
