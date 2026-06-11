import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { buildRoleAppImports } from './config/app-modules.util';
import { CabinetContextMiddleware } from './common/cabinet-context.middleware';

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
    ScheduleModule.forRoot(),
    ...buildRoleAppImports(),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CabinetContextMiddleware).forRoutes('*');
  }
}
