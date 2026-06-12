import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

import { formatError } from '../common/format-error';
import { verifySharedAuthToken } from '../common/shared-auth-token';
import { applyUserForwardedAuthorizationHeader, resolveUserAuthTokenFromRequest } from '../common/worker-proxy-auth.util';
import {
  applyWorkerUserAttestationHeaders,
  WORKER_AUTH_LOGIN_HEADER,
  WORKER_AUTH_ROLE_HEADER,
  WORKER_AUTH_USER_ID_HEADER,
  type RequestWithAuth,
} from '../common/worker-user-attestation.util';
import { shouldProxyUserbotToWorker } from '../config/process-role.util';
import {
  readWorkerUbInternalBaseUrl,
  readWorkerInternalToken,
  workerInternalFetchJson,
} from './worker-http.util';
import type { UserbotGlobalConnectionState } from './internal-userbot.types';
import { isUserbotDashboardReady } from './userbot-dashboard-ready.util';

@Injectable()
export class UserbotInternalProxyService {
  private readonly logger = new Logger(UserbotInternalProxyService.name);

  isEnabled(): boolean {
    return shouldProxyUserbotToWorker() && Boolean(readWorkerUbInternalBaseUrl());
  }

  /** Для dashboard-cabinets на Api: глобальный MTProto-статус с Worker-UB. */
  async fetchGlobalConnectionState(): Promise<UserbotGlobalConnectionState | null> {
    const base = readWorkerUbInternalBaseUrl();
    const token = readWorkerInternalToken();
    if (!this.isEnabled() || !base || !token) {
      return null;
    }
    try {
      return await workerInternalFetchJson<UserbotGlobalConnectionState>(
        base,
        '/internal/userbot/connection',
      );
    } catch (e) {
      this.logger.warn(`fetchGlobalConnectionState failed: ${formatError(e)}`);
      return null;
    }
  }

  /** Достаточно ли userbot для дашборда (live MTProto или завершённая настройка QR/сессии). */
  async isUserbotReadyForDashboard(_userId: string): Promise<boolean> {
    const state = await this.fetchGlobalConnectionState();
    if (!state) {
      return false;
    }
    return isUserbotDashboardReady(state);
  }

  /** @deprecated use fetchGlobalConnectionState / isUserbotReadyForDashboard */
  async probeUserbotConnected(params: {
    cabinetId: string;
    userId: string;
    login: string;
    role?: string;
  }): Promise<boolean> {
    const base = readWorkerUbInternalBaseUrl();
    const token = readWorkerInternalToken();
    const cabinetId = String(params.cabinetId ?? '').trim();
    const login = String(params.login ?? '').trim();
    if (!base || !token || !cabinetId || !login) {
      return false;
    }
    const url = new URL('/telegram-userbot/status', `${base}/`);
    url.searchParams.set('cabinetId', cabinetId);
    const headers = new Headers({
      'X-Internal-Token': token,
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'x-cabinet-id': cabinetId,
      [WORKER_AUTH_LOGIN_HEADER]: login,
      [WORKER_AUTH_USER_ID_HEADER]: String(params.userId ?? '').trim(),
    });
    const role = String(params.role ?? '').trim();
    if (role) {
      headers.set(WORKER_AUTH_ROLE_HEADER, role);
    }
    try {
      const res = await fetch(url.toString(), { method: 'GET', headers, cache: 'no-store' });
      const text = await res.text();
      if (!res.ok) {
        this.logger.debug(
          `probeUserbotConnected cabinet=${cabinetId}: ${res.status} ${text.slice(0, 120)}`,
        );
        return false;
      }
      const json = text.trim() ? (JSON.parse(text) as { connected?: boolean }) : {};
      return Boolean(json.connected);
    } catch (e) {
      this.logger.debug(`probeUserbotConnected failed: ${formatError(e)}`);
      return false;
    }
  }

  async forward(req: Request): Promise<unknown> {
    const base = readWorkerUbInternalBaseUrl();
    const token = readWorkerInternalToken();
    if (!base || !token) {
      throw new Error('Worker userbot proxy is not configured');
    }
    const authReq = req as RequestWithAuth;
    const url = new URL(req.originalUrl || req.url, `${base}/`);
    const headers = new Headers();
    headers.set('X-Internal-Token', token);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    applyUserForwardedAuthorizationHeader(headers, req);
    applyWorkerUserAttestationHeaders(headers, authReq);
    if (!headers.has(WORKER_AUTH_LOGIN_HEADER)) {
      const authSecret =
        process.env.AUTH_JWT_SECRET?.trim() || process.env.API_ACCESS_TOKEN?.trim() || '';
      const userToken = resolveUserAuthTokenFromRequest(req);
      const payload =
        userToken && authSecret
          ? verifySharedAuthToken({ token: userToken, secret: authSecret })
          : null;
      if (payload?.login?.trim()) {
        headers.set(WORKER_AUTH_LOGIN_HEADER, payload.login.trim());
        const userId = String(payload.userId ?? '').trim();
        if (userId) {
          headers.set(WORKER_AUTH_USER_ID_HEADER, userId);
        }
        const role = String(payload.role ?? '').trim();
        if (role) {
          headers.set(WORKER_AUTH_ROLE_HEADER, role);
        }
      }
    }
    const queryCabinetId =
      typeof req.query?.cabinetId === 'string' ? req.query.cabinetId.trim() : '';
    const headerCabinetId =
      typeof req.headers['x-cabinet-id'] === 'string' ? req.headers['x-cabinet-id'].trim() : '';
    const cabinetId = headerCabinetId || queryCabinetId;
    if (cabinetId) {
      headers.set('x-cabinet-id', cabinetId);
    }
    const contentType = req.headers['content-type'];
    if (typeof contentType === 'string') {
      headers.set('Content-Type', contentType);
    }
    const cookie = req.headers.cookie;
    if (typeof cookie === 'string' && cookie.trim()) {
      headers.set('Cookie', cookie.trim());
    }
    let body: string | undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body !== undefined) {
      body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }
    try {
      const res = await fetch(url.toString(), {
        method: req.method,
        headers,
        body,
        cache: 'no-store',
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(`userbot proxy ${req.method} ${url.pathname}: ${res.status}`);
        let body: unknown;
        try {
          body = text.trim() ? JSON.parse(text) : { error: res.statusText };
        } catch {
          body = { error: text || res.statusText };
        }
        throw new HttpException(body as string | Record<string, unknown>, res.status);
      }
      if (!text.trim()) {
        return { ok: true };
      }
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (e) {
      this.logger.error(`userbot proxy failed: ${formatError(e)}`);
      throw e;
    }
  }
}
