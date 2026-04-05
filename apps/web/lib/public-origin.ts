import { withBasePath } from './auth';

/**
 * Публичный origin для Location из Route Handlers за reverse-proxy / Docker.
 * Иначе new URL(..., request.url) часто даёт http://localhost:3000.
 */
export function getPublicOrigin(request: Request): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    try {
      return new URL(site).origin;
    } catch {
      /* ignore */
    }
  }

  const xfHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const xfProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (xfHost) {
    return `${xfProto || 'https'}://${xfHost}`;
  }

  const host = request.headers.get('host')?.split(',')[0]?.trim();
  if (host && !/^127\.0\.0\.1/.test(host) && host !== 'localhost' && !host.startsWith('localhost:')) {
    const proto =
      xfProto ||
      (() => {
        try {
          return new URL(request.url).protocol.replace(':', '') || 'https';
        } catch {
          return 'https';
        }
      })();
    return `${proto}://${host}`;
  }

  try {
    return new URL(request.url).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/** База сайта с basePath для ссылок в письмах (как NEXT_PUBLIC_SITE_URL). */
export function getPublicSiteBase(request: Request): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) {
    return site.replace(/\/+$/, '');
  }
  const origin = getPublicOrigin(request);
  const bp = withBasePath('');
  return `${origin}${bp}`.replace(/\/+$/, '');
}
