import { Module } from '@nestjs/common';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WorkspaceBootstrapService } from './workspace-bootstrap.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, WorkspaceBootstrapService],
  exports: [AuthService, WorkspaceBootstrapService],
})
export class AuthModule {}
