import { HttpException, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

import { formatError } from '../common/format-error';
import { applyUserForwardedAuthorizationHeader } from '../common/worker-proxy-auth.util';
import { shouldProxyUserbotToWorker } from '../config/process-role.util';
import {
  readWorkerUbInternalBaseUrl,
  readWorkerInternalToken,
} from './worker-http.util';

@Injectable()
export class UserbotInternalProxyService {
  private readonly logger = new Logger(UserbotInternalProxyService.name);

  isEnabled(): boolean {
    return shouldProxyUserbotToWorker() && Boolean(readWorkerUbInternalBaseUrl());
  }

  async forward(req: Request): Promise<unknown> {
    const base = readWorkerUbInternalBaseUrl();
    const token = readWorkerInternalToken();
    if (!base || !token) {
      throw new Error('Worker userbot proxy is not configured');
    }
    const url = new URL(req.originalUrl || req.url, `${base}/`);
    const headers = new Headers();
    headers.set('X-Internal-Token', token);
    headers.set('Authorization', `Bearer ${token}`);
    headers.set('Accept', 'application/json');
    applyUserForwardedAuthorizationHeader(headers, req);
    const cabinetId = req.headers['x-cabinet-id'];
    if (typeof cabinetId === 'string' && cabinetId.trim()) {
      headers.set('x-cabinet-id', cabinetId.trim());
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
