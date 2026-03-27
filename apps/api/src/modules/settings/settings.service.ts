import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';

const ENV_FALLBACK: Record<string, string> = {
  /** Номинал по умолчанию, если в БД и .env ключ не задан */
  DEFAULT_ORDER_USD: '10',
};

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

  /**
   * Номинал позиции в USDT, если в сигнале не заданы ни сумма, ни % депозита.
   * Берётся из SQLite → env → 10.
   */
  async getDefaultOrderUsd(): Promise<number> {
    const raw = await this.get('DEFAULT_ORDER_USD');
    const n =
      raw != null && String(raw).trim() !== ''
        ? Number(String(raw).trim().replace(',', '.'))
        : Number.NaN;
    return Number.isFinite(n) && n > 0 ? n : 10;
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
      await tx.diagnosticStepResult.deleteMany();
      await tx.diagnosticLog.deleteMany();
      await tx.diagnosticModelResult.deleteMany();
      await tx.diagnosticCase.deleteMany();
      await tx.diagnosticRun.deleteMany();
      await tx.order.deleteMany();
      await tx.signal.deleteMany();
      await tx.appLog.deleteMany();
      await tx.setting.deleteMany();
    });
  }
}
