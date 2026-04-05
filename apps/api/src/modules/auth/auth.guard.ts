import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_ROUTE } from './auth.decorators';
import { AuthService } from './auth.service';
import type { AuthenticatedRequestContext } from './auth.types';

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
      user?: AuthenticatedRequestContext;
    }>();
    if (String(request.method ?? '').toUpperCase() === 'OPTIONS') {
      return true;
    }

    const authResult = await this.auth.authenticateRequest({
      authorizationHeader: request.headers.authorization,
      workspaceIdHeader: request.headers['x-workspace-id'],
    });
    if (!authResult.ok) {
      throw new UnauthorizedException('Authentication required');
    }
    request.user = authResult.user;
    return true;
  }
}
