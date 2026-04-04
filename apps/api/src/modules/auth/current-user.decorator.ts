import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthenticatedRequestContext } from './auth.types';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedRequestContext | null => {
    const request = ctx.switchToHttp().getRequest<{ user?: AuthenticatedRequestContext }>();
    return request.user ?? null;
  },
);
