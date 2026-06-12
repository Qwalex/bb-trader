import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { extractBearerToken, extractTokenFromCookieHeader } from './auth-token.util';
import { IS_PUBLIC_ENDPOINT_KEY } from './public.decorator';
import { verifySharedAuthToken } from './shared-auth-token';
import { readWorkerUserAttestation } from './worker-user-attestation.util';
import { readWorkerInternalToken } from '../internal/worker-http.util';

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const httpRequest = context.switchToHttp().getRequest<{ method?: string }>();
    if (httpRequest?.method?.toUpperCase() === 'OPTIONS') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(
      IS_PUBLIC_ENDPOINT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      auth?: {
        userId?: string;
        login: string;
        role?: string;
        exp: number;
        iat: number;
      };
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
    const bearer = extractBearerToken(authHeader);
    const cookieToken = extractTokenFromCookieHeader(req.headers?.cookie);
    const internalToken = readWorkerInternalToken();
    const forwardedRaw = req.headers?.['x-forwarded-authorization'];
    const forwardedHeader = Array.isArray(forwardedRaw) ? forwardedRaw[0] : forwardedRaw;

    if (internalToken && bearer === internalToken) {
      const userToken = extractBearerToken(forwardedHeader) ?? cookieToken;
      if (userToken) {
        const payload = verifySharedAuthToken({
          token: userToken,
          secret: authSecret,
        });
        if (payload) {
          req.auth = {
            userId: payload.userId,
            login: payload.login,
            role: payload.role,
            exp: payload.exp,
            iat: payload.iat,
          };
          return true;
        }
        throw new UnauthorizedException('Invalid API access token');
      }
      const attested = readWorkerUserAttestation(req.headers);
      if (attested) {
        req.auth = attested;
        return true;
      }
      throw new UnauthorizedException('Missing forwarded auth token');
    }

    const token = bearer ?? cookieToken;
    if (!token) {
      throw new UnauthorizedException('Missing auth token');
    }
    const payload = verifySharedAuthToken({
      token,
      secret: authSecret,
    });
    if (payload) {
      req.auth = {
        userId: payload.userId,
        login: payload.login,
        role: payload.role,
        exp: payload.exp,
        iat: payload.iat,
      };
      return true;
    }
    throw new UnauthorizedException('Invalid API access token');
  }

}
