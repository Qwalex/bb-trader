import { Module } from '@nestjs/common';

import { AuthService } from './auth.service';
import { WorkspaceBootstrapService } from './workspace-bootstrap.service';

@Module({
  providers: [AuthService, WorkspaceBootstrapService],
  exports: [AuthService, WorkspaceBootstrapService],
})
export class AuthModule {}
