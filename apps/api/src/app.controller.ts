import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from './common/public.decorator';
import { AppService } from './app.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: 'Проверка доступности API' })
  @ApiOkResponse({ description: 'API работает' })
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'signals-bot-api' };
  }
}
