import { LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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

  const swaggerServer = process.env.API_SWAGGER_SERVER?.trim();
  if (!swaggerServer) {
    throw new Error('API_SWAGGER_SERVER is required (e.g. "/trade-api")');
  }
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SignalsBot API')
    .setDescription('REST API для SignalsBot (NestJS)')
    .setVersion('1.0')
    .addServer('/', 'Direct API (local)')
    .addServer(swaggerServer, 'Proxy base path')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  const port = process.env.API_PORT ?? '3001';
  const host = process.env.API_HOST ?? '0.0.0.0';
  await app.listen(parseInt(port, 10), host);
}

void bootstrap();
