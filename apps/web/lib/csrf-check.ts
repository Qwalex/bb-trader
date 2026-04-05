import { getPublicOrigin } from './public-origin';

/**
 * Returns a 403 Response if the request Origin header doesn't match
 * the public origin. Returns null if the check passes.
 */
export function csrfCheck(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (origin && origin !== getPublicOrigin(request)) {
    return new Response('CSRF check failed', { status: 403 });
  }
  return null;
}
