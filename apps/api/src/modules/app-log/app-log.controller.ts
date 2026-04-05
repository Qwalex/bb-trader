import { Controller, Get, Logger, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { requireWorkspaceId } from '../../common/require-workspace-id';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import { AppLogService } from './app-log.service';

@ApiTags('Logs')
@Controller('logs')
export class AppLogController {
  private readonly logger = new Logger(AppLogController.name);

  constructor(private readonly appLog: AppLogService) {}

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
    const workspaceId = requireWorkspaceId(user);
    const rows = await this.appLog.list({
      limit: limit ? parseInt(limit, 10) : 200,
      category: category?.trim() || undefined,
      workspaceId,
    });
    this.logger.debug(
      `logs list requested workspace=${workspaceId} category=${category?.trim() || 'all'} count=${rows.length}`,
    );
    return rows;
  }
}
