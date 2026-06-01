import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { CABINET_LIST_SELECT, mapCabinetListRow } from './cabinet-select.util';
import {
  buildCloneCabinetName,
  buildCloneSettingsInsertRows,
} from './cabinet-clone.util';
import type { CloneCabinetResult } from './cabinet-clone.types';
import type { CabinetListItem } from './cabinet.types';

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

  /** Подпись для уведомлений: имя кабинета из БД или его id. */
  async getCabinetDisplayLabel(cabinetId: string): Promise<string> {
    let id = String(cabinetId ?? '').trim();
    if (!id) {
      id = await this.getDefaultCabinetId();
    }
    try {
      const row = await this.prisma.cabinet.findUnique({
        where: { id },
        select: { name: true },
      });
      const name = row?.name?.trim();
      if (name && name.length > 0) {
        return name;
      }
    } catch {
      // ignore
    }
    return id;
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

  async listCabinets(): Promise<CabinetListItem[]> {
    await this.ensureDefaultCabinet();
    const rows = await this.prisma.cabinet.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: CABINET_LIST_SELECT,
    });
    return rows.map(mapCabinetListRow);
  }

  async listCabinetsForUser(userIdRaw: string | null | undefined): Promise<CabinetListItem[]> {
    const userId = String(userIdRaw ?? '').trim();
    if (!userId) {
      return [];
    }
    await this.ensureUserDefaultCabinet(userId);
    const rows = await this.prisma.cabinet.findMany({
      where: { ownerUserId: userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: CABINET_LIST_SELECT,
    });
    return rows.map(mapCabinetListRow);
  }

  /** Активные кабинеты — для фоновых задач (poll, cron). */
  async listActiveCabinets(): Promise<CabinetListItem[]> {
    const rows = await this.prisma.cabinet.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: CABINET_LIST_SELECT,
    });
    return rows.map(mapCabinetListRow);
  }

  async isCabinetActive(cabinetIdRaw: string | null | undefined): Promise<boolean> {
    const id = String(cabinetIdRaw ?? '').trim();
    if (!id) {
      return false;
    }
    const row = await this.prisma.cabinet.findUnique({
      where: { id },
      select: { isActive: true },
    });
    return row?.isActive === true;
  }

  async listEnabledCabinetIdsForChat(chatId: string): Promise<string[]> {
    const chat = String(chatId ?? '').trim();
    if (!chat) {
      return [];
    }
    const rows = await this.prisma.cabinetTelegramSource.findMany({
      where: {
        chatId: chat,
        enabled: true,
        cabinet: { isActive: true },
      },
      select: { cabinetId: true },
    });
    if (rows.length > 0) {
      return Array.from(new Set(rows.map((r) => r.cabinetId)));
    }
    const defaultId = await this.getDefaultCabinetId();
    if (await this.isCabinetActive(defaultId)) {
      return [defaultId];
    }
    return [];
  }

  private normalizeSlug(value: string): string {
    return String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }

  private async allocateUniqueSlug(baseSlug: string): Promise<string> {
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
    return slug;
  }

  async createCabinet(params: {
    ownerUserId?: string | null;
    name: string;
    slug?: string;
  }): Promise<CabinetListItem> {
    const name = String(params.name ?? '').trim();
    if (!name) {
      throw new Error('Cabinet name is required');
    }
    const baseSlug = this.normalizeSlug(params.slug ?? name);
    if (!baseSlug) {
      throw new Error('Cabinet slug is invalid');
    }
    const slug = await this.allocateUniqueSlug(baseSlug);
    const row = await this.prisma.cabinet.create({
      data: {
        name,
        slug,
        isDefault: false,
        isActive: true,
        ownerUserId: String(params.ownerUserId ?? '').trim() || undefined,
      },
      select: CABINET_LIST_SELECT,
    });
    return mapCabinetListRow(row);
  }

  async cloneCabinet(params: {
    ownerUserId?: string | null;
    sourceCabinetId: string;
  }): Promise<CloneCabinetResult> {
    const ownerUserId = String(params.ownerUserId ?? '').trim() || null;
    const sourceCabinetId = String(params.sourceCabinetId ?? '').trim();
    if (!sourceCabinetId) {
      throw new Error('Cabinet id is required');
    }

    const source = await this.prisma.cabinet.findFirst({
      where: { id: sourceCabinetId, ownerUserId },
      include: {
        settings: true,
        telegramSources: true,
        publishGroups: { where: { cabinetId: sourceCabinetId } },
        balanceAlertRules: true,
        members: true,
      },
    });
    if (!source) {
      throw new Error('Cabinet not found');
    }

    const siblings = await this.prisma.cabinet.findMany({
      where: { ownerUserId },
      select: { name: true },
    });
    const cloneName = buildCloneCabinetName(
      source.name,
      siblings.map((row) => row.name),
    );
    const baseSlug = this.normalizeSlug(cloneName);
    if (!baseSlug) {
      throw new Error('Cabinet slug is invalid');
    }
    const slug = await this.allocateUniqueSlug(baseSlug);
    const statsResetAt = new Date().toISOString();
    const settingRows = buildCloneSettingsInsertRows(source.settings, statsResetAt);

    const created = await this.prisma.$transaction(
      async (tx) => {
        const cabinet = await tx.cabinet.create({
          data: {
            name: cloneName,
            slug,
            isDefault: false,
            isActive: true,
            ownerUserId: ownerUserId ?? undefined,
          },
          select: CABINET_LIST_SELECT,
        });

        if (settingRows.length > 0) {
          await tx.cabinetSetting.createMany({
            data: settingRows.map((row) => ({
              cabinetId: cabinet.id,
              key: row.key,
              value: row.value,
            })),
          });
        }

        if (source.telegramSources.length > 0) {
          await tx.cabinetTelegramSource.createMany({
            data: source.telegramSources.map((src) => ({
              cabinetId: cabinet.id,
              chatId: src.chatId,
              enabled: src.enabled,
              sourcePriority: src.sourcePriority,
              defaultLeverage: src.defaultLeverage,
              forcedLeverage: src.forcedLeverage,
              leverageRangeMode: src.leverageRangeMode,
              minLeverage: src.minLeverage,
              maxLeverage: src.maxLeverage,
              defaultEntryUsd: src.defaultEntryUsd,
              minLotBump: src.minLotBump,
              martingaleMultiplier: src.martingaleMultiplier,
              tpSlStepStart: src.tpSlStepStart,
              tpSlStepRange: src.tpSlStepRange,
            })),
          });
        }

        if (source.publishGroups.length > 0) {
          await tx.tgUserbotPublishGroup.createMany({
            data: source.publishGroups.map((group) => ({
              cabinetId: cabinet.id,
              title: group.title,
              chatId: group.chatId,
              enabled: group.enabled,
              publishEveryN: group.publishEveryN,
              signalCounter: 0,
              linkedToApp: group.linkedToApp,
              contentPublishEnabled: group.contentPublishEnabled,
            })),
          });
        }

        if (source.balanceAlertRules.length > 0) {
          await tx.cabinetBalanceAlertRule.createMany({
            data: source.balanceAlertRules.map((rule) => ({
              cabinetId: cabinet.id,
              operator: rule.operator,
              thresholdUsd: rule.thresholdUsd,
              enabled: rule.enabled,
              lastSatisfied: null,
            })),
          });
        }

        if (source.members.length > 0) {
          await tx.cabinetMember.createMany({
            data: source.members.map((member) => ({
              cabinetId: cabinet.id,
              telegramUserId: member.telegramUserId,
              role: member.role,
              isActive: member.isActive,
            })),
          });
        }

        return cabinet;
      },
      { maxWait: 10_000, timeout: 30_000 },
    );

    this.logger.log(
      `Cloned cabinet source=${sourceCabinetId} -> id=${created.id} slug=${created.slug}`,
    );

    return {
      item: mapCabinetListRow(created),
    };
  }

  async updateCabinet(params: {
    ownerUserId?: string | null;
    id: string;
    name?: string;
    slug?: string;
    isActive?: boolean;
  }): Promise<CabinetListItem> {
    const id = String(params.id ?? '').trim();
    if (!id) throw new Error('Cabinet id is required');
    const data: { name?: string; slug?: string; isActive?: boolean } = {};
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
    if (params.isActive != null) {
      data.isActive = Boolean(params.isActive);
    }
    const ownerUserId = String(params.ownerUserId ?? '').trim() || null;
    const existing = await this.prisma.cabinet.findFirst({
      where: { id, ownerUserId },
      select: { id: true, isDefault: true },
    });
    if (!existing?.id) {
      throw new Error('Cabinet not found');
    }
    if (existing.isDefault && params.isActive === false) {
      throw new Error('Default cabinet cannot be deactivated');
    }
    const row = await this.prisma.cabinet.update({
      where: { id: existing.id },
      data,
      select: CABINET_LIST_SELECT,
    });
    return mapCabinetListRow(row);
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

