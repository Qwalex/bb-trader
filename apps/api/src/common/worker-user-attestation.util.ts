import type { Request } from 'express';

export const WORKER_AUTH_USER_ID_HEADER = 'x-auth-user-id';
export const WORKER_AUTH_LOGIN_HEADER = 'x-auth-login';
export const WORKER_AUTH_ROLE_HEADER = 'x-auth-role';

export type RequestAuthContext = {
  userId?: string;
  login: string;
  role?: string;
  exp: number;
  iat: number;
};

export type RequestWithAuth = Request & { auth?: RequestAuthContext };

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string {
  const raw = headers?.[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return String(value ?? '').trim();
}

/** После ApiAuthGuard на Api — attestation для Worker (internal token обязателен на Worker). */
export function applyWorkerUserAttestationHeaders(
  headers: Headers,
  req: RequestWithAuth,
): void {
  const auth = req.auth;
  if (!auth?.login?.trim()) {
    return;
  }
  headers.set(WORKER_AUTH_LOGIN_HEADER, auth.login.trim());
  const userId = String(auth.userId ?? '').trim();
  if (userId) {
    headers.set(WORKER_AUTH_USER_ID_HEADER, userId);
  }
  const role = String(auth.role ?? '').trim();
  if (role) {
    headers.set(WORKER_AUTH_ROLE_HEADER, role);
  }
}

export function readWorkerUserAttestation(
  headers: Record<string, string | string[] | undefined> | undefined,
): RequestAuthContext | null {
  const login = headerValue(headers, WORKER_AUTH_LOGIN_HEADER);
  if (!login) {
    return null;
  }
  const userId = headerValue(headers, WORKER_AUTH_USER_ID_HEADER) || undefined;
  const role = headerValue(headers, WORKER_AUTH_ROLE_HEADER) || undefined;
  return {
    userId,
    login,
    role,
    exp: 0,
    iat: 0,
  };
}
