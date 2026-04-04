import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import { AppLogService } from './app-log.service';

@ApiTags('Logs')
@Controller('logs')
export class AppLogController {
  constructor(private readonly appLog: AppLogService) {}

  private requireWorkspaceId(user: AuthenticatedRequestContext | null): string {
    const workspaceId = user?.workspaceId?.trim();
    if (!workspaceId) {
      throw new ForbiddenException('Workspace context is required');
    }
    return workspaceId;
  }

  @ApiOperation({ summary: 'Список логов приложения' })
  @ApiQuery({ name: 'limit', required: false, description: 'Лимит записей' })
  @ApiQuery({ name: 'category', required: false, description: 'Фильтр категории' })
  @ApiOkResponse({ description: 'Логи получены' })
  @Get()
  async list(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Query('limit') limit?: string,
    @Query('category') category?: string,
  ) {
    return this.appLog.list({
      limit: limit ? parseInt(limit, 10) : 200,
      category: category?.trim() || undefined,
      workspaceId: this.requireWorkspaceId(user),
    });
  }
}
