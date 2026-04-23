import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from './common/public.decorator';
import { AppService } from './app.service';
import { WorkerQueueService } from './modules/worker-queue/worker-queue.service';

@ApiTags('Health')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly workers: WorkerQueueService,
  ) {}

  @ApiOperation({ summary: 'Проверка доступности API' })
  @ApiOkResponse({ description: 'API работает' })
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: 'signals-bot-api' };
  }

  @ApiOperation({ summary: 'Статус фоновых очередей' })
  @ApiOkResponse({ description: 'Очереди получены' })
  @Get('health/queues')
  async queueHealth() {
    return {
      status: 'ok',
      queues: await this.workers.getStats(),
    };
  }
}
