import { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap() {
  const debug =
    process.env.LOG_LEVEL === 'debug' || process.env.LOG_LEVEL === 'verbose';
  const logLevels: LogLevel[] = debug
    ? ['error', 'warn', 'log', 'debug', 'verbose']
    : ['error', 'warn', 'log'];

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });
  app.enableCors({ origin: true });
  const port = process.env.API_PORT ?? '3001';
  const host = process.env.API_HOST ?? '0.0.0.0';
  await app.listen(parseInt(port, 10), host);
}

void bootstrap();
