export function normalizeBasePath(raw: string | undefined): string {
  const value = String(raw ?? '').trim();
  if (!value || value === '/') {
    return '';
  }
  return (value.startsWith('/') ? value : `/${value}`).replace(/\/+$/, '');
}

export function withAppBasePath(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  return `${basePath}${path}`;
}
