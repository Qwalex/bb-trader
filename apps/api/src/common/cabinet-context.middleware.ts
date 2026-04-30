import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import { extractBearerToken, extractTokenFromCookieHeader } from './auth-token.util';
import { pickRequestedCabinetId } from './cabinet-request.util';
import { verifySharedAuthToken } from './shared-auth-token';
import { CabinetContextService } from '../modules/cabinet/cabinet-context.service';
import { CabinetService } from '../modules/cabinet/cabinet.service';

@Injectable()
export class CabinetContextMiddleware implements NestMiddleware {
  constructor(
    private readonly config: ConfigService,
    private readonly cabinets: CabinetService,
    private readonly cabinetContext: CabinetContextService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const cookieMap: Record<string, string> = {};
    const cookieRaw = String(req.headers.cookie ?? '');
    for (const part of cookieRaw.split(';')) {
      const [k, ...rest] = part.split('=');
      const key = k?.trim();
      if (!key) continue;
      const value = rest.join('=').trim();
      if (!value) continue;
      try {
        cookieMap[key] = decodeURIComponent(value);
      } catch {
        cookieMap[key] = value;
      }
    }
    const rawCabinetParam = req.query?.cabinetId;
    let queryCabinetId: string | undefined;
    if (typeof rawCabinetParam === 'string') {
      queryCabinetId = rawCabinetParam;
    } else if (Array.isArray(rawCabinetParam)) {
      const first = rawCabinetParam[0];
      if (typeof first === 'string') {
        queryCabinetId = first;
      }
    }
    const requested = pickRequestedCabinetId({
      queryCabinetId,
      headers: req.headers as Record<string, string | string[] | undefined>,
      cookies: cookieMap,
    });
    const rawAuth = req.headers.authorization;
    const authHeader = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;
    const token =
      extractBearerToken(authHeader) ?? extractTokenFromCookieHeader(req.headers.cookie);
    const authSecret =
      this.config.get<string>('AUTH_JWT_SECRET')?.trim() ??
      this.config.get<string>('API_ACCESS_TOKEN')?.trim() ??
      '';
    const payload =
      token && authSecret
        ? verifySharedAuthToken({
            token,
            secret: authSecret,
          })
        : null;
    const userId = String(payload?.userId ?? '').trim() || null;
    const cabinetId = userId
      ? await this.cabinets.resolveCabinetIdForUser(userId, requested)
      : await this.cabinets.resolveCabinetId(requested);
    this.cabinetContext.runWithCabinet(cabinetId, () => next());
  }
}

