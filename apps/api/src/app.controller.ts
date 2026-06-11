import { Controller, ForbiddenException, Get, Inject, Optional, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from './common/public.decorator';
import { AppService } from './app.service';
import { WorkerQueueService } from './modules/worker-queue/worker-queue.service';
import { healthServiceLabel } from './config/process-role.util';

@ApiTags('Health')
@Controller()
export class AppController {
  private assertAdmin(req: { auth?: { role?: string } }) {
    if (String(req.auth?.role ?? '').trim().toLowerCase() !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
  }

  constructor(
    private readonly appService: AppService,
    @Optional() private readonly workers: WorkerQueueService | null,
  ) {}

  @ApiOperation({ summary: 'Проверка доступности API' })
  @ApiOkResponse({ description: 'API работает' })
  @Public()
  @Get('health')
  health() {
    return { status: 'ok', service: healthServiceLabel() };
  }

  @ApiOperation({ summary: 'Статус фоновых очередей' })
  @ApiOkResponse({ description: 'Очереди получены' })
  @Get('health/queues')
  async queueHealth(@Req() req: { auth?: { role?: string } }) {
    this.assertAdmin(req);
    if (!this.workers) {
      return { status: 'ok', queues: null, note: 'worker queue not enabled in this process role' };
    }
    return {
      status: 'ok',
      queues: await this.workers.getStats(),
    };
  }
}
