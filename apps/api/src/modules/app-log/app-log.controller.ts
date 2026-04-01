import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { AppLogService } from './app-log.service';

@ApiTags('Logs')
@Controller('logs')
export class AppLogController {
  constructor(private readonly appLog: AppLogService) {}

  @ApiOperation({ summary: 'Список логов приложения' })
  @ApiQuery({ name: 'limit', required: false, description: 'Лимит записей' })
  @ApiQuery({ name: 'category', required: false, description: 'Фильтр категории' })
  @ApiOkResponse({ description: 'Логи получены' })
  @Get()
  async list(
    @Query('limit') limit?: string,
    @Query('category') category?: string,
  ) {
    return this.appLog.list({
      limit: limit ? parseInt(limit, 10) : 200,
      category: category?.trim() || undefined,
    });
  }
}
