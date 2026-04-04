import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class WorkspaceBootstrapService {
  constructor(private readonly prisma: PrismaService) {}

  private slugify(input: string): string {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9а-яё]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  async ensureBootstrapWorkspace(user: {
    userId: string;
    email: string | null;
    workspaceName?: string | null;
    workspaceSlug?: string | null;
  }): Promise<{ workspaceId: string; role: string }> {
    const existingMembership = await this.prisma.workspaceMember.findFirst({
      where: { userId: user.userId },
      select: { workspaceId: true, role: true },
    });
    if (existingMembership) {
      return {
        workspaceId: existingMembership.workspaceId,
        role: existingMembership.role,
      };
    }

    const baseName =
      user.workspaceName?.trim() ||
      (user.email?.split('@')[0]?.trim() ? `${user.email.split('@')[0]} workspace` : 'My workspace');
    const baseSlug = this.slugify(user.workspaceSlug?.trim() || baseName) || `workspace-${user.userId.slice(0, 8)}`;

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.userProfile.upsert({
        where: { id: user.userId },
        create: {
          id: user.userId,
          email: user.email ?? `${user.userId}@unknown.local`,
          displayName: baseName,
        },
        update: {
          email: user.email ?? undefined,
          displayName: baseName,
        },
      });

      let slug = baseSlug;
      let suffix = 1;
      while (await tx.workspace.findUnique({ where: { slug }, select: { id: true } })) {
        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const workspace = await tx.workspace.create({
        data: {
          slug,
          name: baseName,
          ownerUserId: user.userId,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.userId,
          role: 'owner',
        },
      });

      return { workspaceId: workspace.id, role: 'owner' };
    });

    return result;
  }
}
