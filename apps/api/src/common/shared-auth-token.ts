import { createHmac, timingSafeEqual } from 'node:crypto';

type SharedTokenPayload = {
  sub: string;
  userId?: string;
  login: string;
  role?: string;
  iat: number;
  exp: number;
};

function base64UrlEncode(raw: string): string {
  return Buffer.from(raw, 'utf8').toString('base64url');
}

function base64UrlDecode(raw: string): string {
  return Buffer.from(raw, 'base64url').toString('utf8');
}

function signRaw(message: string, secret: string): string {
  return createHmac('sha256', secret).update(message).digest('base64url');
}

export function issueSharedAuthToken(params: {
  userId?: string;
  login: string;
  role?: string;
  secret: string;
  ttlSeconds: number;
  subject?: string;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const payload: SharedTokenPayload = {
    sub: params.subject ?? 'shared-account',
    userId: params.userId,
    login: params.login,
    role: params.role,
    iat: nowSec,
    exp: nowSec + Math.max(60, Math.floor(params.ttlSeconds)),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signRaw(encodedPayload, params.secret);
  return `${encodedPayload}.${signature}`;
}

export function verifySharedAuthToken(params: {
  token: string;
  secret: string;
}): SharedTokenPayload | null {
  const raw = String(params.token ?? '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 2) return null;
  const payloadPart = parts[0] ?? '';
  const sigPart = parts[1] ?? '';
  if (!payloadPart || !sigPart) return null;
  const expectedSig = signRaw(payloadPart, params.secret);
  const givenBuf = Buffer.from(sigPart);
  const expectedBuf = Buffer.from(expectedSig);
  if (givenBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(givenBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(base64UrlDecode(payloadPart)) as SharedTokenPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.login !== 'string' || !parsed.login.trim()) return null;
    if (parsed.userId != null && typeof parsed.userId !== 'string') return null;
    if (parsed.role != null && typeof parsed.role !== 'string') return null;
    if (!Number.isFinite(parsed.iat) || !Number.isFinite(parsed.exp)) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (parsed.exp < nowSec) return null;
    return parsed;
  } catch {
    return null;
  }
}

