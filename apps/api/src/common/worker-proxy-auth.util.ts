import type { Request } from 'express';

import {
  extractBearerToken,
  extractTokenFromCookieHeader,
} from './auth-token.util';

/** JWT пользователя из Authorization или cookie `sb_auth_token` (как в ApiAuthGuard). */
export function resolveUserAuthTokenFromRequest(req: Request): string | null {
  const rawHeader = req.headers?.authorization;
  const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  return (
    extractBearerToken(authHeader) ??
    extractTokenFromCookieHeader(req.headers?.cookie)
  );
}

/** Проброс user JWT на Worker при internal Authorization. */
export function applyUserForwardedAuthorizationHeader(
  headers: Headers,
  req: Request,
): void {
  const userToken = resolveUserAuthTokenFromRequest(req);
  if (!userToken) {
    return;
  }
  headers.set('X-Forwarded-Authorization', `Bearer ${userToken}`);
}
