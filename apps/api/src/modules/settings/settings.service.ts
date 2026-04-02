import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';

import {
  parseDefaultEntryRaw,
  resolveDefaultEntryToUsd,
} from './entry-sizing.util';

const ENV_FALLBACK: Record<string, string> = {
  /** Номинал по умолчанию, если в БД и .env ключ не задан */
  DEFAULT_ORDER_USD: '10',
  /** Если true — при номинале ниже minQty биржи поднимать qty до минимума (старое поведение); иначе ошибка */
  BUMP_TO_MIN_EXCHANGE_LOT: 'false',
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
   * Строка настройки: число USDT ("10") или процент от equity ("10%").
   * Для режима % нужен balanceTotalUsd (суммарный USDT на счёте); иначе — fallback 10.
   */
  async getDefaultOrderUsd(balanceTotalUsd?: number | null): Promise<number> {
    const raw = await this.get('DEFAULT_ORDER_USD');
    return this.resolveDefaultEntryUsdFromRaw(raw, balanceTotalUsd);
  }

  /**
   * Дефолт входа: глобальная настройка или переопределение по чату (строка как в DEFAULT_ORDER_USD).
   */
  async resolveDefaultEntryUsd(opts: {
    rawOverride?: string | null;
    balanceTotalUsd?: number | null;
  }): Promise<number> {
    const raw =
      opts.rawOverride != null && String(opts.rawOverride).trim() !== ''
        ? String(opts.rawOverride).trim()
        : await this.get('DEFAULT_ORDER_USD');
    return this.resolveDefaultEntryUsdFromRaw(raw, opts.balanceTotalUsd);
  }

  resolveDefaultEntryUsdFromRaw(
    raw: string | undefined,
    balanceTotalUsd?: number | null,
  ): number {
    const spec = parseDefaultEntryRaw(raw);
    const fbRaw = ENV_FALLBACK.DEFAULT_ORDER_USD ?? '10';
    const fbSpec = parseDefaultEntryRaw(fbRaw);
    const fallbackUsd =
      fbSpec.kind === 'fixed' && fbSpec.usd > 0 ? fbSpec.usd : 10;
    return resolveDefaultEntryToUsd(spec, balanceTotalUsd, fallbackUsd);
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
