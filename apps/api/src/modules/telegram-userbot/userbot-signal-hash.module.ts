import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AppLogModule } from '../app-log/app-log.module';
import { UserbotSignalHashService } from './userbot-signal-hash.service';

@Module({
  imports: [PrismaModule, AppLogModule],
  providers: [UserbotSignalHashService],
  exports: [UserbotSignalHashService],
})
export class UserbotSignalHashModule {}
