import { Global, Module } from '@nestjs/common';

import { CabinetController } from './cabinet.controller';
import { CabinetContextService } from './cabinet-context.service';
import { CabinetService } from './cabinet.service';

@Global()
@Module({
  controllers: [CabinetController],
  providers: [CabinetService, CabinetContextService],
  exports: [CabinetService, CabinetContextService],
})
export class CabinetModule {}

