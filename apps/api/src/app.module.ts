import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AppLogModule } from './modules/app-log/app-log.module';
import { AuthModule } from './modules/auth/auth.module';
import { BybitModule } from './modules/bybit/bybit.module';
import { DashboardAuthGuard } from './modules/auth/auth.guard';
import { OrdersModule } from './modules/orders/orders.module';
import { DiagnosticsModule } from './modules/diagnostics/diagnostics.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TelegramModule } from './modules/telegram/telegram.module';
import { TelegramUserbotModule } from './modules/telegram-userbot/telegram-userbot.module';
import { TranscriptModule } from './modules/transcript/transcript.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Порядок: сначала корень монорепо (если cwd = apps/api), затем cwd/.env,
 * затем apps/api/.env от корня — последние файлы перекрывают предыдущие (Nest).
 */
function loadEnvFilePaths(): string[] {
  const paths: string[] = [];
  const cwd = process.cwd();
  const localEnv = join(cwd, '.env');

  if (basename(cwd) === 'api') {
    const monorepoRootEnv = join(cwd, '..', '..', '.env');
    if (existsSync(monorepoRootEnv)) {
      paths.push(monorepoRootEnv);
    }
  }

  if (existsSync(localEnv)) {
    paths.push(localEnv);
  }

  const nestedApi = join(cwd, 'apps', 'api', '.env');
  if (existsSync(nestedApi)) {
    paths.push(nestedApi);
  }

  return paths.length > 0 ? paths : ['.env'];
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: loadEnvFilePaths(),
    }),
    AuthModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    AppLogModule,
    DiagnosticsModule,
    SettingsModule,
    OrdersModule,
    TranscriptModule,
    BybitModule,
    TelegramModule,
    TelegramUserbotModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: DashboardAuthGuard,
    },
  ],
})
export class AppModule {}
