import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { BybitModule } from '../bybit/bybit.module';
import { OrdersModule } from '../orders/orders.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptModule } from '../transcript/transcript.module';
import { DiagnosticsAiService } from './diagnostics.ai.service';
import { DiagnosticsController } from './diagnostics.controller';
import { DiagnosticsMetricsVerifier } from './diagnostics.metrics-verifier';
import { DiagnosticsService } from './diagnostics.service';
import { DiagnosticsTraceBuilder } from './diagnostics.trace-builder';
import { TradingAiAdvisorService } from './trading-ai-advisor.service';

@Module({
  imports: [PrismaModule, SettingsModule, OrdersModule, BybitModule, TranscriptModule],
  controllers: [DiagnosticsController],
  providers: [
    DiagnosticsService,
    DiagnosticsTraceBuilder,
    DiagnosticsAiService,
    DiagnosticsMetricsVerifier,
    TradingAiAdvisorService,
  ],
})
export class DiagnosticsModule {}
