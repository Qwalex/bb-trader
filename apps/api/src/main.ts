import { LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { ApiAuthGuard } from './common/api-auth.guard';
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
  app.useGlobalGuards(
    new ApiAuthGuard(app.get(Reflector), app.get(ConfigService)),
  );
  const allowedOriginsRaw = process.env.API_CORS_ORIGINS ?? '';
  const allowedOrigins = allowedOriginsRaw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const allowAnyOrigin = process.env.NODE_ENV !== 'production';
  app.enableCors({
    origin:
      allowedOrigins.length > 0 ? allowedOrigins : allowAnyOrigin ? true : false,
  });

  // Без reverse-proxy (Railway напрямую): обычно "/". За nginx с префиксом — тот же префикс, напр. "/trade-api".
  const swaggerServer =
    process.env.API_SWAGGER_SERVER?.trim() || '/';
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SignalsBot API')
    .setDescription('REST API для SignalsBot (NestJS)')
    .setVersion('1.0')
    .addServer(swaggerServer, 'Proxy base path')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const portRaw = process.env.PORT ?? process.env.API_PORT ?? '3001';
  const port = parseInt(portRaw, 10);
  const host = process.env.API_HOST ?? '0.0.0.0';
  await app.listen(port, host);
}

void bootstrap();
