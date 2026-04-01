import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { AppLogService } from './app-log.service';

@ApiTags('Logs')
@Controller('logs')
export class AppLogController {
  constructor(private readonly appLog: AppLogService) {}

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
