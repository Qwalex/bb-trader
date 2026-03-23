import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';

const ENV_FALLBACK: Record<string, string> = {};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async get(key: string): Promise<string | undefined> {
    const row = await this.prisma.setting.findUnique({ where: { key } });
    if (row?.value !== undefined && row?.value !== '') {
      return row.value;
    }
    const fromEnv = this.config.get<string>(key);
    if (fromEnv !== undefined && fromEnv !== '') {
      return fromEnv;
    }
    const fromProcess = process.env[key];
    if (fromProcess !== undefined && fromProcess !== '') {
      return fromProcess;
    }
    return ENV_FALLBACK[key];
  }

  async set(key: string, value: string): Promise<void> {
    await this.prisma.setting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  async getMany(keys: string[]): Promise<Record<string, string | undefined>> {
    const out: Record<string, string | undefined> = {};
    for (const k of keys) {
      out[k] = await this.get(k);
    }
    return out;
  }

  async list(): Promise<{ key: string; value: string }[]> {
    return this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
  }

  /**
   * Полная очистка SQLite: ордера, сигналы, логи, настройки в БД.
   * Переменные окружения не трогаются.
   */
  async resetAllData(): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.order.deleteMany();
      await tx.signal.deleteMany();
      await tx.appLog.deleteMany();
      await tx.setting.deleteMany();
    });
  }
}
