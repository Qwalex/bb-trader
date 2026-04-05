import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import { CreateWorkspaceDto } from './create-workspace.dto';
import { WorkspacesService } from './workspaces.service';

@ApiTags('Workspaces')
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspaces: WorkspacesService) {}

  @ApiOperation({ summary: 'Кабинеты текущего пользователя' })
  @ApiOkResponse({ description: 'Список кабинетов' })
  @Get()
  async list(@CurrentUser() user: AuthenticatedRequestContext | null) {
    return this.workspaces.listForUser(user!.userId);
  }

  @ApiOperation({ summary: 'Создать новый кабинет (логин)' })
  @ApiOkResponse({ description: 'Кабинет создан' })
  @Post()
  async create(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Body() body: CreateWorkspaceDto,
  ) {
    return this.workspaces.createForUser(user!.userId, body.login);
  }
}
