import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { readCookieValue } from '../../../../lib/api-auth.util';
import { getServerApiBaseCandidates } from '../../../../lib/api-base.util';
import {
  AUTH_COOKIE,
  AUTH_TOKEN_COOKIE,
} from '../../../../lib/api.constants';

type RouteContext = {
  params: Promise<{ path?: string[] }>;
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function buildTargetUrl(apiBase: string, request: Request, path: string[]): string {
  const source = new URL(request.url);
  const safePath = path.map((part) => encodeURIComponent(part)).join('/');
  return `${apiBase}/${safePath}${source.search}`;
}

async function buildForwardHeaders(request: Request): Promise<Headers> {
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === 'host') {
      return;
    }
    headers.set(key, value);
  });

  const cookieStore = await cookies();
  const sessionToken =
    cookieStore.get(AUTH_COOKIE)?.value?.trim() ||
    cookieStore.get(AUTH_TOKEN_COOKIE)?.value?.trim() ||
    readCookieValue(request.headers.get('cookie') ?? '', AUTH_COOKIE)?.trim() ||
    readCookieValue(request.headers.get('cookie') ?? '', AUTH_TOKEN_COOKIE)?.trim();
  const fallbackToken = process.env.API_ACCESS_TOKEN?.trim();
  const token = sessionToken || fallbackToken;
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else {
    headers.delete('authorization');
    headers.delete('Authorization');
  }

  return headers;
}

async function proxyApiRequest(request: Request, context: RouteContext): Promise<Response> {
  const { path = [] } = await context.params;
  const method = request.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: await buildForwardHeaders(request),
    cache: 'no-store',
    redirect: 'manual',
  };

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = await request.arrayBuffer();
  }

  const bases = getServerApiBaseCandidates();
  let upstream: Response | null = null;
  let lastError: unknown;
  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i] ?? '';
    try {
      upstream = await fetch(buildTargetUrl(base, request, path), init);
      break;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      const retryable =
        i < bases.length - 1 &&
        (code === 'ENOTFOUND' || code === 'ECONNREFUSED' || code === 'EAI_AGAIN');
      if (!retryable) {
        console.error(`BFF proxy fetch failed (${base}):`, error);
        return NextResponse.json(
          { message: 'Upstream API unavailable', error: 'Bad Gateway', statusCode: 502 },
          { status: 502 },
        );
      }
    }
  }
  if (!upstream) {
    console.error('BFF proxy: no upstream response', lastError);
    return NextResponse.json(
      { message: 'Upstream API unavailable', error: 'Bad Gateway', statusCode: 502 },
      { status: 502 },
    );
  }
  const responseHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export async function GET(request: Request, context: RouteContext) {
  return proxyApiRequest(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return proxyApiRequest(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return proxyApiRequest(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return proxyApiRequest(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return proxyApiRequest(request, context);
}

export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
