import { Module } from '@nestjs/common';

import { TelegramModule } from '../telegram';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [TelegramModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}

