import { Module } from '@nestjs/common';

import { buildQpulseSyncModuleImports } from './qpulse-sync-module.imports.util';
import { QpulseSyncService } from './qpulse-sync.service';
import { SignalDistributionService } from './signal-distribution.service';

@Module({
  imports: buildQpulseSyncModuleImports(),
  providers: [QpulseSyncService, SignalDistributionService],
  exports: [QpulseSyncService, SignalDistributionService],
})
export class QpulseSyncModule {}
