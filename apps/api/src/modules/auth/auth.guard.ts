import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { INTERNAL_API_AUTH_HEADER } from '@repo/shared';

import { IS_PUBLIC_ROUTE } from './auth.decorators';
import { AuthService } from './auth.service';

@Injectable()
export class DashboardAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      method?: string;
      headers: Record<string, string | string[] | undefined>;
      user?: { sub: string; via: 'session' | 'internal' };
    }>();
    if (String(request.method ?? '').toUpperCase() === 'OPTIONS') {
      return true;
    }

    const session = await this.auth.authenticateRequest({
      cookieHeader: typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined,
      internalHeader: request.headers[INTERNAL_API_AUTH_HEADER],
    });
    if (!session) {
      throw new UnauthorizedException('Authentication required');
    }
    request.user = session;
    return true;
  }
}
