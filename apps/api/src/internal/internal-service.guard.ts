import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { extractBearerToken } from '../common/auth-token.util';
import { readWorkerInternalToken } from './worker-http.util';

@Injectable()
export class InternalServiceGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
    }>();
    const expected = readWorkerInternalToken();
    if (!expected) {
      throw new UnauthorizedException('Internal service auth is not configured');
    }
    const headers = req.headers ?? {};
    const headerToken = String(headers['x-internal-token'] ?? '').trim();
    const authHeader = headers.authorization;
    const authStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    const bearer = extractBearerToken(authStr)?.trim() ?? '';
    const token = headerToken || bearer;
    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid internal service token');
    }
    return true;
  }
}
