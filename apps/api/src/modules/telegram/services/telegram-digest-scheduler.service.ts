import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Telegraf } from 'telegraf';

import { formatError } from '../../../common/format-error';
import { PrismaService } from '../../../prisma/prisma.service';
import { BybitService } from '../../bybit/bybit.service';
import { CabinetContextService } from '../../cabinet/cabinet-context.service';
import { OrdersService } from '../../orders/orders.service';
import { SettingsService } from '../../settings/settings.service';
import { formatTelegramDailyDigestHtml } from '../utils/telegram-daily-digest-html.util';
import { splitTelegramHtml } from '../utils/telegram-html.util';
import { parseTelegramWhitelistUserIds } from '../utils/telegram-whitelist.util';

import { TelegramBotRegistryService } from './telegram-bot-registry.service';

const DIGEST_CRON_JOB_NAME = 'telegram_daily_digest';

@Injectable()
export class TelegramDigestSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramDigestSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly cabinetContext: CabinetContextService,
    private readonly settings: SettingsService,
    private readonly botRegistry: TelegramBotRegistryService,
    private readonly orders: OrdersService,
    private readonly bybit: BybitService,
  ) {}

  onModuleInit(): void {
    if (this.isDigestDisabled()) {
      this.logger.log('Ежедневный Telegram-дайджест выключен (TELEGRAM_DAILY_DIGEST_ENABLED=false)');
      return;
    }
    const expr =
      this.config.get<string>('TELEGRAM_DAILY_DIGEST_CRON')?.trim() || '0 0 9 * * *';
    try {
      const job = new CronJob(expr, () => {
        void this.runDailyDigestForAllCabinets().catch((e) =>
          this.logger.warn(`daily digest cron: ${formatError(e)}`),
        );
      });
      this.scheduler.addCronJob(DIGEST_CRON_JOB_NAME, job);
      job.start();
      this.logger.log(`Ежедневный Telegram-дайджест: cron «${expr}» (серверное время процесса)`);
    } catch (e) {
      this.logger.error(
        `TelegramDigestScheduler: неверный TELEGRAM_DAILY_DIGEST_CRON «${expr}»: ${formatError(e)}`,
      );
    }
  }

  onModuleDestroy(): void {
    try {
      const job = this.scheduler.getCronJob(DIGEST_CRON_JOB_NAME);
      job.stop();
      this.scheduler.deleteCronJob(DIGEST_CRON_JOB_NAME);
    } catch {
      // job не регистрировался (дайджест выключен или ошибка cron при старте)
    }
  }

  private isDigestDisabled(): boolean {
    const v = this.config.get<string>('TELEGRAM_DAILY_DIGEST_ENABLED');
    const t = String(v ?? '').trim().toLowerCase();
    return t === 'false' || t === '0' || t === 'off';
  }

  async runDailyDigestForAllCabinets(): Promise<void> {
    if (this.isDigestDisabled()) {
      return;
    }
    if (this.botRegistry.launchedCount === 0) {
      return;
    }
    try {
      for (const [cabinetId, bot] of this.botRegistry.entries()) {
        await this.sendDigestForCabinet(cabinetId, bot);
      }
    } catch (e) {
      this.logger.warn(`daily digest: ${formatError(e)}`);
    }
  }

  private async sendDigestForCabinet(cabinetId: string, bot: Telegraf): Promise<void> {
    await this.cabinetContext.runWithCabinet(cabinetId, async () => {
      const ids = parseTelegramWhitelistUserIds(
        String((await this.settings.get('TELEGRAM_WHITELIST')) ?? '').trim(),
      );
      if (ids.length === 0) {
        return;
      }

      const [cab, digest, tops, details] = await Promise.all([
        this.prisma.cabinet.findUnique({
          where: { id: cabinetId },
          select: { name: true },
        }),
        this.orders.getDailyDigestModel(),
        this.orders.getTopSources({ limit: 3 }),
        this.bybit.getUnifiedUsdtBalanceDetails(),
      ]);
      const cabinetName = cab?.name?.trim() || cabinetId;
      const balanceLine =
        details !== undefined && Number.isFinite(details.availableUsd)
          ? `баланс ${details.totalUsd.toFixed(2)} · доступно ${details.availableUsd.toFixed(2)} USDT`
          : 'нет данных по API';
      const html = formatTelegramDailyDigestHtml({
        cabinetName,
        digest,
        balanceLine,
        tops: { byPnl: tops.byPnl, byWinrate: tops.byWinrate },
      });
      const chunks = splitTelegramHtml(html);
      for (const uid of ids) {
        for (const chunk of chunks) {
          try {
            await bot.telegram.sendMessage(uid, chunk, { parse_mode: 'HTML' });
          } catch (err) {
            this.logger.warn(
              `daily digest: cabinet=${cabinetId} user=${uid}: ${formatError(err)}`,
            );
          }
        }
        await new Promise((r) => setTimeout(r, 400));
      }
    });
  }
}
