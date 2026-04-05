import { Module, forwardRef } from '@nestjs/common';

import { BybitModule } from '../bybit/bybit.module';

import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  imports: [forwardRef(() => BybitModule)],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
