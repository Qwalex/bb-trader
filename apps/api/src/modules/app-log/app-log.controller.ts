import { Controller, ForbiddenException, Get, Query, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AppLogService } from './app-log.service';

@ApiTags('Logs')
@Controller('logs')
export class AppLogController {
  constructor(private readonly appLog: AppLogService) {}

  private parseLimit(raw: string | undefined): number {
    if (!raw) {
      return 200;
    }
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) {
      return 200;
    }
    return Math.min(Math.max(n, 1), 1000);
  }

  private isAdmin(req: { auth?: { role?: string } }): boolean {
    return String(req.auth?.role ?? '').trim().toLowerCase() === 'admin';
  }

  @ApiOperation({ summary: 'Список логов приложения' })
  @ApiQuery({ name: 'limit', required: false, description: 'Лимит записей' })
  @ApiQuery({ name: 'category', required: false, description: 'Фильтр категории' })
  @ApiOkResponse({ description: 'Логи получены' })
  @Get()
  async list(
    @Req() req: { auth?: { role?: string } },
    @Query('limit') limit?: string,
    @Query('category') category?: string,
  ) {
    if (!this.isAdmin(req)) {
      throw new ForbiddenException('Логи доступны только администратору');
    }
    return this.appLog.list({
      limit: this.parseLimit(limit),
      category: category?.trim() || undefined,
    });
  }
}
