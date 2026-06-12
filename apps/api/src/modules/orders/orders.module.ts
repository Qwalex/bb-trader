import { Module } from '@nestjs/common';

import { buildOrdersModuleImports } from './orders-module.imports.util';
import { OrdersController } from './orders.controller';
import { LeverageAiAdvisorService } from './leverage-ai-advisor.service';
import { OrdersService } from './orders.service';

@Module({
  imports: buildOrdersModuleImports(),
  controllers: [OrdersController],
  providers: [OrdersService, LeverageAiAdvisorService],
  exports: [OrdersService],
})
export class OrdersModule {}
