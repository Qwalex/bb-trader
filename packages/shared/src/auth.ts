const encoder = new TextEncoder();

export const DASHBOARD_SESSION_COOKIE = 'signalsbot_session';
export const INTERNAL_API_AUTH_HEADER = 'x-signalsbot-internal-auth';
export const DEFAULT_DASHBOARD_SESSION_TTL_SECONDS = 60 * 60 * 12;

export type DashboardSessionPayload = {
  sub: string;
  exp: number;
  scope: 'dashboard';
};

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string): Uint8Array | null {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = normalized.length % 4;
  const padded = normalized + (padLength === 0 ? '' : '='.repeat(4 - padLength));
  try {
    const binary = atob(padded);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return toBase64Url(new Uint8Array(signature));
}

export async function createDashboardSessionToken(
  secret: string,
  username: string,
  ttlSeconds = DEFAULT_DASHBOARD_SESSION_TTL_SECONDS,
): Promise<string> {
  const payload: DashboardSessionPayload = {
    sub: username,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    scope: 'dashboard',
  };
  const payloadPart = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signaturePart = await sign(secret, payloadPart);
  return `${payloadPart}.${signaturePart}`;
}

export async function verifyDashboardSessionToken(
  secret: string,
  token: string | null | undefined,
): Promise<DashboardSessionPayload | null> {
  const raw = String(token ?? '').trim();
  if (!raw) {
    return null;
  }
  const parts = raw.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadPart, signaturePart] = parts;
  if (!payloadPart || !signaturePart) {
    return null;
  }
  const expectedSignature = await sign(secret, payloadPart);
  if (signaturePart !== expectedSignature) {
    return null;
  }
  const payloadBytes = fromBase64Url(payloadPart);
  if (!payloadBytes) {
    return null;
  }
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(payloadBytes),
    ) as Partial<DashboardSessionPayload>;
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.exp !== 'number' ||
      payload.scope !== 'dashboard'
    ) {
      return null;
    }
    if (!Number.isFinite(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return {
      sub: payload.sub,
      exp: payload.exp,
      scope: 'dashboard',
    };
  } catch {
    return null;
  }
}
