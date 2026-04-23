import { forwardRef, Module } from '@nestjs/common';

import { BybitModule } from '../bybit/bybit.module';
import { CabinetModule } from '../cabinet/cabinet.module';
import { WorkerQueueService } from './worker-queue.service';

@Module({
  imports: [CabinetModule, forwardRef(() => BybitModule)],
  providers: [WorkerQueueService],
  exports: [WorkerQueueService],
})
export class WorkerQueueModule {}

