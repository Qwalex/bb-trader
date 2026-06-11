import { Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

import { formatError } from '../common/format-error';
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
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.trim()) {
      headers.set('X-Forwarded-Authorization', auth);
    }
    const cabinetId = req.headers['x-cabinet-id'];
    if (typeof cabinetId === 'string' && cabinetId.trim()) {
      headers.set('x-cabinet-id', cabinetId.trim());
    }
    const contentType = req.headers['content-type'];
    if (typeof contentType === 'string') {
      headers.set('Content-Type', contentType);
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
        try {
          return JSON.parse(text);
        } catch {
          return { ok: false, error: text || res.statusText };
        }
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
