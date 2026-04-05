import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { WorkspaceBootstrapService } from '../auth/workspace-bootstrap.service';

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspaceBootstrap: WorkspaceBootstrapService,
  ) {}

  async listForUser(userId: string) {
    const rows = await this.prisma.workspaceMember.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
      include: {
        workspace: { select: { id: true, name: true, slug: true } },
      },
    });
    // На старых данных теоретически могли быть дубликаты membership — в UI не дублируем кабинет
    const seen = new Set<string>();
    const workspaces: {
      id: string;
      name: string;
      slug: string;
      role: string;
    }[] = [];
    for (const r of rows) {
      const id = r.workspace.id;
      if (seen.has(id)) continue;
      seen.add(id);
      workspaces.push({
        id,
        name: r.workspace.name,
        slug: r.workspace.slug,
        role: r.role,
      });
    }
    return { workspaces };
  }

  async createForUser(userId: string, login: string) {
    const trimmed = login.trim();
    if (!trimmed) {
      throw new BadRequestException('Укажите логин кабинета');
    }
    const workspace = await this.workspaceBootstrap.createWorkspaceForOwner(userId, trimmed);
    return { workspace };
  }

  private async assertWorkspaceOwner(userId: string, workspaceId: string): Promise<void> {
    const ws = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, ownerUserId: userId },
      select: { id: true },
    });
    if (!ws) {
      throw new ForbiddenException('Нет прав на этот кабинет (только владелец)');
    }
  }

  async updateNameForOwner(userId: string, workspaceId: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException('Укажите название');
    }
    await this.assertWorkspaceOwner(userId, workspaceId);
    const workspace = await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { name: trimmed },
      select: { id: true, name: true, slug: true },
    });
    return {
      workspace: { ...workspace, role: 'owner' as const },
    };
  }

  async deleteForOwner(userId: string, workspaceId: string) {
    await this.assertWorkspaceOwner(userId, workspaceId);
    const membershipCount = await this.prisma.workspaceMember.count({
      where: { userId },
    });
    if (membershipCount <= 1) {
      throw new BadRequestException('Нельзя удалить последний кабинет');
    }
    await this.prisma.workspace.delete({ where: { id: workspaceId } });
    return { ok: true as const };
  }
}
