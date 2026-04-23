import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_ENDPOINT_KEY } from './public.decorator';
import { verifySharedAuthToken } from './shared-auth-token';

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
    const authSecret =
      this.config.get<string>('AUTH_JWT_SECRET')?.trim() ??
      this.config.get<string>('API_ACCESS_TOKEN')?.trim() ??
      '';
    if (!authSecret) {
      throw new UnauthorizedException('Auth is not configured');
    }
    const rawHeader = req.headers?.authorization;
    const authHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    const token =
      this.extractBearerToken(authHeader) ??
      this.extractTokenFromCookieHeader(req.headers?.cookie);
    if (!token) {
      throw new UnauthorizedException('Missing auth token');
    }
    const payload = verifySharedAuthToken({
      token,
      secret: authSecret,
    });
    if (payload) {
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

  private extractTokenFromCookieHeader(
    value?: string | string[],
  ): string | null {
    const raw = Array.isArray(value) ? value[0] : value;
    const text = String(raw ?? '').trim();
    if (!text) return null;
    for (const part of text.split(';')) {
      const [k, ...rest] = part.split('=');
      if (String(k ?? '').trim() !== 'sb_auth_token') continue;
      const v = rest.join('=').trim();
      if (!v) return null;
      try {
        return decodeURIComponent(v);
      } catch {
        return v;
      }
    }
    return null;
  }

}
