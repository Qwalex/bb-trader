import { forwardRef, Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';

import { AppLogController } from './app-log.controller';
import { AppLogService } from './app-log.service';

@Module({
  imports: [PrismaModule, forwardRef(() => SettingsModule)],
  controllers: [AppLogController],
  providers: [AppLogService],
  exports: [AppLogService],
})
export class AppLogModule {}
