import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';

import { formatError } from '../../../common/format-error';

import { BalanceAlertService } from './balance-alert.service';

const BALANCE_ALERT_CRON_JOB_NAME = 'balance_alert_tick';

@Injectable()
export class BalanceAlertSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BalanceAlertSchedulerService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly balanceAlert: BalanceAlertService,
  ) {}

  onModuleInit(): void {
    if (this.isDisabled()) {
      this.logger.log('Пороговые уведомления о балансе выключены (BALANCE_ALERT_ENABLED=false)');
      return;
    }
    const expr = this.config.get<string>('BALANCE_ALERT_CRON')?.trim() || '0 */5 * * * *';
    try {
      const job = new CronJob(expr, () => {
        void this.balanceAlert.tickAllCabinets().catch((e) =>
          this.logger.warn(`balance alert cron: ${formatError(e)}`),
        );
      });
      this.scheduler.addCronJob(BALANCE_ALERT_CRON_JOB_NAME, job);
      job.start();
      this.logger.log(`Balance alert cron: «${expr}» (серверное время процесса)`);
    } catch (e) {
      this.logger.error(
        `BalanceAlertScheduler: неверный BALANCE_ALERT_CRON «${expr}»: ${formatError(e)}`,
      );
    }
  }

  onModuleDestroy(): void {
    try {
      const job = this.scheduler.getCronJob(BALANCE_ALERT_CRON_JOB_NAME);
      void job.stop();
      this.scheduler.deleteCronJob(BALANCE_ALERT_CRON_JOB_NAME);
    } catch {
      // job не регистрировался
    }
  }

  private isDisabled(): boolean {
    const v = this.config.get<string>('BALANCE_ALERT_ENABLED');
    const t = String(v ?? '').trim().toLowerCase();
    return t === 'false' || t === '0' || t === 'off';
  }
}
