#!/usr/bin/env node
/**
 * Smoke GET-маршрутов cabinets (Api + опционально Web BFF).
 * Usage:
 *   SMOKE_LOGIN=... SMOKE_PASSWORD=... node scripts/smoke-cabinets-api-routes.mjs
 *   SMOKE_TOKEN=eyJ... node scripts/smoke-cabinets-api-routes.mjs
 * Env: SMOKE_API_URL, SMOKE_WEB_URL, SMOKE_CABINET_ID
 */
import { createHmac } from 'node:crypto';
import { SMOKE_GET_ENDPOINTS } from './smoke-cabinets-api-endpoints.constants.mjs';

const API_URL = (process.env.SMOKE_API_URL ?? 'https://qwalex-trader-cabinets-api.up.railway.app').replace(/\/$/, '');
const WEB_URL = (process.env.SMOKE_WEB_URL ?? 'https://qwalex-trader-cabinets.up.railway.app').replace(/\/$/, '');
const CABINET_ID = process.env.SMOKE_CABINET_ID?.trim() ?? '';

function withCabinet(path) {
  if (!CABINET_ID) return path;
  const sep = path.includes('?') ? '&' : '?';
  if (path.includes('cabinetId=')) return path;
  return `${path}${sep}cabinetId=${encodeURIComponent(CABINET_ID)}`;
}

async function loginToken() {
  if (process.env.SMOKE_TOKEN?.trim()) {
    return process.env.SMOKE_TOKEN.trim();
  }
  const login = process.env.SMOKE_LOGIN?.trim();
  const password = process.env.SMOKE_PASSWORD ?? '';
  if (!login || !password) {
    return null;
  }
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.accessToken) {
    throw new Error(`login failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return String(json.accessToken);
}

async function probe(label, url, headers) {
  const res = await fetch(url, { headers, cache: 'no-store' });
  const text = await res.text();
  let message = text.slice(0, 120);
  try {
    const j = JSON.parse(text);
    message = j.message ?? j.error ?? message;
  } catch {
    // keep text
  }
  return { label, url, status: res.status, message };
}

async function main() {
  const token = await loginToken();
  const authHeaders = token
    ? { Authorization: `Bearer ${token}`, ...(CABINET_ID ? { 'x-cabinet-id': CABINET_ID } : {}) }
    : {};

  let failed = 0;
  console.log(`=== smoke GET (api=${API_URL} cabinet=${CABINET_ID || 'default'} auth=${token ? 'yes' : 'no'}) ===`);

  for (const item of SMOKE_GET_ENDPOINTS) {
    const path = withCabinet(item.path);
    if (item.public) {
      const r = await probe('api', `${API_URL}${path}`, {});
      const ok = r.status === 200;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.status} ${path}${ok ? '' : ` :: ${r.message}`}`);
      if (!ok) failed += 1;
      continue;
    }
    if (!token) {
      const r = await probe('api', `${API_URL}${path}`, {});
      const ok = r.status === 401;
      console.log(`${ok ? 'OK  ' : 'FAIL'} ${r.status} ${path} (no auth, expect 401)${ok ? '' : ` :: ${r.message}`}`);
      if (!ok) failed += 1;
      continue;
    }
    const rApi = await probe('api', `${API_URL}${path}`, authHeaders);
    const okApi = rApi.status >= 200 && rApi.status < 500;
    console.log(`${okApi ? 'OK  ' : 'FAIL'} ${rApi.status} api ${path}${okApi ? '' : ` :: ${rApi.message}`}`);
    if (!okApi) failed += 1;

    if (path.startsWith('/telegram-userbot/')) {
      const rWeb = await probe('web-bff', `${WEB_URL}/api/backend${path}`, {
        Cookie: `sb_auth=${encodeURIComponent(token)}`,
      });
      const okWeb = rWeb.status >= 200 && rWeb.status < 500;
      console.log(`${okWeb ? 'OK  ' : 'FAIL'} ${rWeb.status} bff ${path}${okWeb ? '' : ` :: ${rWeb.message}`}`);
      if (!okWeb) failed += 1;
    }
  }

  if (failed === 0) {
    console.log('=== all smoke checks passed ===');
  } else {
    console.log(`=== ${failed} check(s) failed ===`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
