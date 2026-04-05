import { ForbiddenException } from '@nestjs/common';

import type { AuthenticatedRequestContext } from '../modules/auth/auth.types';

export function requireWorkspaceId(
  user: AuthenticatedRequestContext | null | undefined,
): string {
  const id = user?.workspaceId?.trim();
  if (!id) {
    throw new ForbiddenException('Workspace context is required');
  }
  return id;
}
