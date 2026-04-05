import { BadRequestException, Injectable } from '@nestjs/common';

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
}
