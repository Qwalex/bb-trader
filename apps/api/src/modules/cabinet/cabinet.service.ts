import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_CABINET_ID = 'cab_main';
const DEFAULT_CABINET_SLUG = 'main';
const DEFAULT_CABINET_NAME = 'Main';

@Injectable()
export class CabinetService implements OnModuleInit {
  private readonly logger = new Logger(CabinetService.name);
  private defaultCabinetIdCache: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaultCabinet();
  }

  async ensureDefaultCabinet(): Promise<{ id: string; slug: string; name: string }> {
    let cabinet = await this.prisma.cabinet.findFirst({
      where: { isDefault: true },
      select: { id: true, slug: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!cabinet) {
      cabinet = await this.prisma.cabinet.upsert({
        where: { id: DEFAULT_CABINET_ID },
        create: {
          id: DEFAULT_CABINET_ID,
          slug: DEFAULT_CABINET_SLUG,
          name: DEFAULT_CABINET_NAME,
          isDefault: true,
        },
        update: {
          slug: DEFAULT_CABINET_SLUG,
          name: DEFAULT_CABINET_NAME,
          isDefault: true,
        },
        select: { id: true, slug: true, name: true },
      });
      this.logger.log(`Created default cabinet id=${cabinet.id}`);
    }
    this.defaultCabinetIdCache = cabinet.id;
    return cabinet;
  }

  async getDefaultCabinetId(): Promise<string> {
    if (this.defaultCabinetIdCache) {
      return this.defaultCabinetIdCache;
    }
    const row = await this.prisma.cabinet.findFirst({
      where: { isDefault: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (row?.id) {
      this.defaultCabinetIdCache = row.id;
      return row.id;
    }
    const created = await this.ensureDefaultCabinet();
    return created.id;
  }

  async resolveCabinetId(preferred?: string | null): Promise<string> {
    const requested = String(preferred ?? '').trim();
    if (requested) {
      const row = await this.prisma.cabinet.findUnique({
        where: { id: requested },
        select: { id: true },
      });
      if (row?.id) {
        return row.id;
      }
      const bySlug = await this.prisma.cabinet.findUnique({
        where: { slug: requested.toLowerCase() },
        select: { id: true },
      });
      if (bySlug?.id) {
        return bySlug.id;
      }
    }
    return this.getDefaultCabinetId();
  }

  private async ensureUserDefaultCabinet(userIdRaw: string): Promise<string> {
    const userId = String(userIdRaw ?? '').trim();
    if (!userId) {
      return this.getDefaultCabinetId();
    }
    const existing = await this.prisma.cabinet.findFirst({
      where: { ownerUserId: userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    if (existing?.id) {
      return existing.id;
    }
    const baseSlug = this.normalizeSlug(`main-${userId.slice(0, 8)}`) || 'main-user';
    let slug = baseSlug;
    let idx = 2;
    for (;;) {
      const dupe = await this.prisma.cabinet.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!dupe) break;
      slug = `${baseSlug}-${idx}`;
      idx += 1;
      if (idx > 1000) {
        throw new Error('Unable to generate unique default cabinet slug');
      }
    }
    const created = await this.prisma.cabinet.create({
      data: {
        slug,
        name: DEFAULT_CABINET_NAME,
        isDefault: false,
        ownerUserId: userId,
      },
      select: { id: true },
    });
    return created.id;
  }

  async resolveCabinetIdForUser(
    userIdRaw: string | null | undefined,
    preferred?: string | null,
  ): Promise<string> {
    const userId = String(userIdRaw ?? '').trim();
    if (!userId) {
      return this.resolveCabinetId(preferred);
    }
    const requested = String(preferred ?? '').trim();
    if (requested) {
      const byId = await this.prisma.cabinet.findFirst({
        where: { id: requested, ownerUserId: userId },
        select: { id: true },
      });
      if (byId?.id) return byId.id;
      const bySlug = await this.prisma.cabinet.findFirst({
        where: { slug: requested.toLowerCase(), ownerUserId: userId },
        select: { id: true },
      });
      if (bySlug?.id) return bySlug.id;
    }
    return this.ensureUserDefaultCabinet(userId);
  }

  async resolveCabinetForTelegramUser(
    telegramUserId: number,
    preferred?: string | null,
  ): Promise<string> {
    const explicit = String(preferred ?? '').trim();
    if (explicit) {
      return this.resolveCabinetId(explicit);
    }
    const row = await this.prisma.cabinetMember.findFirst({
      where: {
        telegramUserId: String(telegramUserId),
        isActive: true,
      },
      orderBy: { createdAt: 'asc' },
      select: { cabinetId: true },
    });
    if (row?.cabinetId) {
      return row.cabinetId;
    }
    return this.getDefaultCabinetId();
  }

  async listCabinets(): Promise<
    Array<{ id: string; slug: string; name: string; isDefault: boolean }>
  > {
    await this.ensureDefaultCabinet();
    return this.prisma.cabinet.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        isDefault: true,
      },
    });
  }

  async listCabinetsForUser(
    userIdRaw: string | null | undefined,
  ): Promise<Array<{ id: string; slug: string; name: string; isDefault: boolean }>> {
    const userId = String(userIdRaw ?? '').trim();
    if (!userId) {
      return [];
    }
    await this.ensureUserDefaultCabinet(userId);
    return this.prisma.cabinet.findMany({
      where: { ownerUserId: userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        slug: true,
        name: true,
        isDefault: true,
      },
    });
  }

  async listEnabledCabinetIdsForChat(chatId: string): Promise<string[]> {
    const chat = String(chatId ?? '').trim();
    if (!chat) {
      return [];
    }
    const rows = await this.prisma.cabinetTelegramSource.findMany({
      where: { chatId: chat, enabled: true },
      select: { cabinetId: true },
    });
    if (rows.length > 0) {
      return Array.from(new Set(rows.map((r) => r.cabinetId)));
    }
    return [await this.getDefaultCabinetId()];
  }

  private normalizeSlug(value: string): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  async createCabinet(params: {
    ownerUserId?: string | null;
    name: string;
    slug?: string;
  }): Promise<{ id: string; slug: string; name: string; isDefault: boolean }> {
    const name = String(params.name ?? '').trim();
    if (!name) {
      throw new Error('Cabinet name is required');
    }
    const baseSlug = this.normalizeSlug(params.slug ?? name);
    if (!baseSlug) {
      throw new Error('Cabinet slug is invalid');
    }
    let slug = baseSlug;
    let idx = 2;
    for (;;) {
      const exists = await this.prisma.cabinet.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (!exists) break;
      slug = `${baseSlug}-${idx}`;
      idx += 1;
      if (idx > 1000) {
        throw new Error('Unable to generate unique cabinet slug');
      }
    }
    return this.prisma.cabinet.create({
      data: {
        name,
        slug,
        isDefault: false,
        ownerUserId: String(params.ownerUserId ?? '').trim() || undefined,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        isDefault: true,
      },
    });
  }

  async updateCabinet(params: {
    ownerUserId?: string | null;
    id: string;
    name?: string;
    slug?: string;
  }): Promise<{ id: string; slug: string; name: string; isDefault: boolean }> {
    const id = String(params.id ?? '').trim();
    if (!id) throw new Error('Cabinet id is required');
    const data: { name?: string; slug?: string } = {};
    if (params.name != null) {
      const name = String(params.name).trim();
      if (!name) throw new Error('Cabinet name is invalid');
      data.name = name;
    }
    if (params.slug != null) {
      const slug = this.normalizeSlug(params.slug);
      if (!slug) throw new Error('Cabinet slug is invalid');
      data.slug = slug;
    }
    const ownerUserId = String(params.ownerUserId ?? '').trim() || null;
    const existing = await this.prisma.cabinet.findFirst({
      where: { id, ownerUserId },
      select: { id: true },
    });
    if (!existing?.id) {
      throw new Error('Cabinet not found');
    }
    return this.prisma.cabinet.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        slug: true,
        name: true,
        isDefault: true,
      },
    });
  }

  async deleteCabinet(
    idRaw: string,
    ownerUserIdRaw?: string | null,
  ): Promise<{ ok: true }> {
    const id = String(idRaw ?? '').trim();
    if (!id) throw new Error('Cabinet id is required');
    const ownerUserId = String(ownerUserIdRaw ?? '').trim() || null;
    const cabinet = await this.prisma.cabinet.findFirst({
      where: { id, ownerUserId },
      select: { id: true, isDefault: true },
    });
    if (!cabinet) throw new Error('Cabinet not found');
    if (cabinet.isDefault) {
      throw new Error('Default cabinet cannot be deleted');
    }
    const deleted = await this.prisma.cabinet.deleteMany({
      where: { id, ownerUserId },
    });
    if (deleted.count === 0) {
      throw new Error('Cabinet not found');
    }
    return { ok: true };
  }
}

export { DEFAULT_CABINET_ID };

