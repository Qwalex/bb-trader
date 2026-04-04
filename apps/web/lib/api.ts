import { normalizeBasePath } from './auth';

export function getApiBase(): string {
  const isServer = typeof window === 'undefined';
  if (isServer) {
    return (
      process.env.API_INTERNAL_URL?.replace(/\/$/, '') ??
      process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ??
      'http://api:3001'
    );
  }
  const configured = process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '');
  if (configured) {
    return configured;
  }
  const basePath = normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
  return (
    `${window.location.origin}${basePath ? `${basePath}-api` : '/api'}`
  );
}
