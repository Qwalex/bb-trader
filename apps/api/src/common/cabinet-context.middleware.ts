import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { pickRequestedCabinetId } from './cabinet-request.util';
import { CabinetContextService } from '../modules/cabinet/cabinet-context.service';
import { CabinetService } from '../modules/cabinet/cabinet.service';

@Injectable()
export class CabinetContextMiddleware implements NestMiddleware {
  constructor(
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
      cookieMap[key] = decodeURIComponent(value);
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
    const cabinetId = await this.cabinets.resolveCabinetId(requested);
    this.cabinetContext.runWithCabinet(cabinetId, () => next());
  }
}

