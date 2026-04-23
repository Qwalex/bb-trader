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
}

export { DEFAULT_CABINET_ID };

