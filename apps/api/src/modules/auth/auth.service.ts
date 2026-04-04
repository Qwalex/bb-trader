import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DASHBOARD_SESSION_COOKIE,
  verifyDashboardSessionToken,
} from '@repo/shared';

@Injectable()
export class AuthService {
  constructor(private readonly config: ConfigService) {}

  private getSessionSecret(): string | null {
    const secret = this.config.get<string>('AUTH_SESSION_SECRET')?.trim();
    return secret && secret.length > 0 ? secret : null;
  }

  private getInternalToken(): string | null {
    const token = this.config.get<string>('API_INTERNAL_AUTH_TOKEN')?.trim();
    if (token && token.length > 0) {
      return token;
    }
    return this.getSessionSecret();
  }

  private parseCookieValue(cookieHeader: string | undefined, name: string): string | null {
    const raw = String(cookieHeader ?? '');
    if (!raw) {
      return null;
    }
    for (const chunk of raw.split(';')) {
      const [cookieName, ...rest] = chunk.trim().split('=');
      if (cookieName === name) {
        return rest.join('=');
      }
    }
    return null;
  }

  async authenticateRequest(input: {
    cookieHeader?: string;
    internalHeader?: string | string[] | undefined;
  }): Promise<{ sub: string; via: 'session' | 'internal' } | null> {
    const internalHeader = Array.isArray(input.internalHeader)
      ? input.internalHeader[0]
      : input.internalHeader;
    const expectedInternal = this.getInternalToken();
    if (
      expectedInternal &&
      typeof internalHeader === 'string' &&
      internalHeader.trim() === expectedInternal
    ) {
      return { sub: 'internal-web', via: 'internal' };
    }

    const sessionSecret = this.getSessionSecret();
    if (!sessionSecret) {
      return null;
    }
    const sessionToken = this.parseCookieValue(
      input.cookieHeader,
      DASHBOARD_SESSION_COOKIE,
    );
    const payload = await verifyDashboardSessionToken(sessionSecret, sessionToken);
    if (!payload) {
      return null;
    }
    return { sub: payload.sub, via: 'session' };
  }

  getAllowedCorsOrigins(): string[] {
    const configured = this.config.get<string>('WEB_CORS_ORIGINS') ?? '';
    const values = configured
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    if (values.length > 0) {
      return Array.from(new Set(values));
    }
    const webOrigin = this.config.get<string>('WEB_ORIGIN')?.trim();
    const defaults = [
      webOrigin,
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3003',
      'http://127.0.0.1:3003',
    ].filter((v): v is string => typeof v === 'string' && v.length > 0);
    return Array.from(new Set(defaults));
  }
}
