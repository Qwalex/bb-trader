import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AppLogService } from '../app-log/app-log.service';
import { formatError } from '../../common/format-error';
import {
  computeUserbotSignalHash,
  signalDtoFromSignalRow,
} from './userbot-signal-hash.util';
import type { SignalDto } from '@repo/shared';

@Injectable()
export class UserbotSignalHashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appLog: AppLogService,
  ) {}

  computeHash(signal: SignalDto): string {
    return computeUserbotSignalHash(signal);
  }

  async tryCreate(hash: string): Promise<boolean> {
    try {
      await this.prisma.tgUserbotSignalHash.create({ data: { hash } });
      return true;
    } catch (e) {
      if (this.isUniqueConstraintError(e)) {
        return false;
      }
      throw e;
    }
  }

  async release(hash: string): Promise<void> {
    try {
      await this.prisma.tgUserbotSignalHash.deleteMany({
        where: { hash },
      });
      void this.appLog.append('debug', 'telegram', 'Userbot: released signal hash', {
        signalHash: hash,
      });
    } catch (e) {
      void this.appLog.append('warn', 'telegram', 'Userbot: failed to release signal hash', {
        signalHash: hash,
        error: formatError(e),
      });
    }
  }

  /**
   * Снимает дедуп-хеш после закрытия сделки (любой путь: API, userbot, poll).
   * Без этого повторный сигнал с теми же уровнями считается дубликатом.
   */
  async releaseForSignalId(signalId: string): Promise<void> {
    const row = await this.prisma.signal.findFirst({
      where: { id: signalId, deletedAt: null },
      select: {
        pair: true,
        direction: true,
        entries: true,
        entryIsRange: true,
        stopLoss: true,
        takeProfits: true,
        leverage: true,
        orderUsd: true,
        capitalPercent: true,
        source: true,
      },
    });
    if (!row) {
      return;
    }
    const dto = signalDtoFromSignalRow(row);
    const hash = computeUserbotSignalHash(dto);
    await this.release(hash);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    const code = (error as { code?: string } | null)?.code;
    return code === 'P2002';
  }
}
