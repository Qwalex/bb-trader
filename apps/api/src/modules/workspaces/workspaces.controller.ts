import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedRequestContext } from '../auth/auth.types';
import { CreateWorkspaceDto } from './create-workspace.dto';
import { UpdateWorkspaceDto } from './update-workspace.dto';
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

  @ApiOperation({ summary: 'Переименовать кабинет (только владелец)' })
  @ApiOkResponse({ description: 'Кабинет обновлён' })
  @Patch(':id')
  async update(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
    @Body() body: UpdateWorkspaceDto,
  ) {
    return this.workspaces.updateNameForOwner(user!.userId, id, body.name);
  }

  @ApiOperation({ summary: 'Удалить кабинет (только владелец, не последний)' })
  @ApiOkResponse({ description: 'Кабинет удалён' })
  @Delete(':id')
  async remove(
    @CurrentUser() user: AuthenticatedRequestContext | null,
    @Param('id') id: string,
  ) {
    return this.workspaces.deleteForOwner(user!.userId, id);
  }
}
