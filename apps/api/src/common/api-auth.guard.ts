import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_ENDPOINT_KEY } from './public.decorator';

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ENDPOINT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const expectedToken =
      this.config.get<string>('API_ACCESS_TOKEN')?.trim() ?? '';
    const rawHeader = req.headers?.authorization;
    const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const token = this.extractBearerToken(authHeader);

    if (expectedToken && token === expectedToken) {
      return true;
    }

    if (!expectedToken) {
      this.assertSameOriginBrowserRequest(req.headers);
      return true;
    }

    if (!token) {
      this.assertSameOriginBrowserRequest(req.headers);
      return true;
    }

    throw new UnauthorizedException('Invalid API access token');
  }

  private extractBearerToken(value?: string): string | null {
    const raw = String(value ?? '').trim();
    if (!raw) {
      return null;
    }
    const match = raw.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || null;
  }

  private assertSameOriginBrowserRequest(
    headers?: Record<string, string | string[] | undefined>,
  ): void {
    const pick = (key: string): string => {
      const raw = headers?.[key];
      const value = Array.isArray(raw) ? raw[0] : raw;
      return String(value ?? '').trim();
    };
    const secFetchSite = pick('sec-fetch-site').toLowerCase();
    if (
      secFetchSite === 'same-origin' ||
      secFetchSite === 'same-site' ||
      secFetchSite === 'none'
    ) {
      return;
    }

    const host = pick('host').toLowerCase();
    if (!host) {
      throw new ForbiddenException('API access denied: missing host header');
    }
    const expectedHost = host.split(',')[0]?.trim() ?? host;
    const parseHost = (value: string): string | null => {
      if (!value) return null;
      try {
        return new URL(value).host.toLowerCase();
      } catch {
        return null;
      }
    };
    const originHost = parseHost(pick('origin'));
    const refererHost = parseHost(pick('referer'));
    const sameOrigin =
      (originHost != null && originHost === expectedHost) ||
      (refererHost != null && refererHost === expectedHost);
    if (!sameOrigin) {
      throw new ForbiddenException(
        'API доступен только с того же origin или с валидным API токеном',
      );
    }
  }
}
