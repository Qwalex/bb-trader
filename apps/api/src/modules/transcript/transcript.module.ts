import { Module, forwardRef } from '@nestjs/common';

import { AppLogModule } from '../app-log/app-log.module';
import { BybitModule } from '../bybit/bybit.module';
import { CabinetModule } from '../cabinet/cabinet.module';
import { SettingsModule } from '../settings/settings.module';
import { TranscriptOpenRouterBillingService } from './transcript-openrouter-billing.service';
import { TranscriptOpenRouterClientService } from './transcript-openrouter-client.service';
import { TranscriptOpenRouterModelChainService } from './transcript-openrouter-model-chain.service';
import { TranscriptService } from './transcript.service';

@Module({
  imports: [
    SettingsModule,
    AppLogModule,
    CabinetModule,
    forwardRef(() => BybitModule),
  ],
  providers: [
    TranscriptService,
    TranscriptOpenRouterModelChainService,
    TranscriptOpenRouterBillingService,
    TranscriptOpenRouterClientService,
  ],
  exports: [TranscriptService],
})
export class TranscriptModule {}
