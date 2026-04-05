import { LogLevel, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { AuthService } from './modules/auth/auth.service';
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
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const auth = app.get(AuthService);
  const allowedOrigins = auth.getAllowedCorsOrigins();
  app.enableCors({
    credentials: true,
    origin(
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('Origin is not allowed by CORS'));
    },
  });

  const swaggerServer = process.env.API_SWAGGER_SERVER?.trim();
  if (!swaggerServer) {
    throw new Error('API_SWAGGER_SERVER is required (e.g. "/trade-api")');
  }
  if (process.env.API_ENABLE_SWAGGER !== 'false') {
    app.use(['/docs', '/docs-json'], (req: Request, res: Response, next: NextFunction) => {
      void auth
        .authenticateRequest({
          authorizationHeader: req.headers.authorization,
        })
        .then((session) => {
          if (!session) {
            res.status(401).json({ message: 'Authentication required' });
            return;
          }
          next();
        })
        .catch(() => {
          res.status(500).json({ message: 'Failed to validate auth' });
        });
    });

    const swaggerConfig = new DocumentBuilder()
      .setTitle('SignalsBot API')
      .setDescription('REST API для SignalsBot (NestJS)')
      .setVersion('1.0')
      .addServer(swaggerServer, 'Proxy base path')
      .build();
    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, swaggerDocument, {
      swaggerOptions: {
        persistAuthorization: false,
      },
    });
  }

  const port = process.env.API_PORT ?? '3001';
  const host = process.env.API_HOST ?? '0.0.0.0';
  await app.listen(parseInt(port, 10), host);
}

void bootstrap();
