import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { loadEnv } from './config/env.js';
import { requestContextMiddleware } from './common/request-context.middleware.js';

export async function createApp() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Atrás do Next.js (rewrite) e/ou reverse proxy: confiar apenas em redes privadas.
  app.set('trust proxy', 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');
  app.use(requestContextMiddleware);
  app.use(helmet({ contentSecurityPolicy: env.NODE_ENV === 'production' }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();

  if (env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Ordens TMS API')
      .setDescription('API da plataforma de Ordens de Carregamento. Autenticação por cookie de sessão + X-CSRF-Token.')
      .setVersion('0.1.0')
      .addCookieAuth('ordens_sid')
      .build();
    SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));
  }

  return { app, env };
}

async function bootstrap() {
  const { app, env } = await createApp();
  await app.listen(env.API_PORT, '0.0.0.0');
}

if (process.env.ORDENS_NO_LISTEN !== 'true') {
  bootstrap().catch((err) => {
    console.error('Falha ao iniciar a API', err);
    process.exit(1);
  });
}
