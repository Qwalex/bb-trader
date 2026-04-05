import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedRequestContext } from './auth.types';
import { CurrentUser } from './current-user.decorator';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  @ApiOperation({ summary: 'Текущий пользователь и роль в приложении' })
  @ApiOkResponse({ description: 'Профиль сессии' })
  @Get('me')
  me(@CurrentUser() user: AuthenticatedRequestContext | null) {
    if (!user?.userId) {
      throw new UnauthorizedException();
    }
    return {
      userId: user.userId,
      email: user.email,
      workspaceId: user.workspaceId,
      role: user.role,
      appRole: user.appRole,
    };
  }
}
