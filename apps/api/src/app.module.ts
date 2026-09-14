import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { GlobalErrorFilter } from './common/error.filter.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { CsrfGuard } from './common/guards/csrf.guard.js';
import { PermissionGuard } from './common/guards/permission.guard.js';
import { requestContext } from './common/request-context.js';
import { InfraModule } from './infra/infra.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { RegistryModule } from './modules/registry/registry.module.js';
import { CommercialModule } from './modules/commercial/commercial.module.js';
import { LogisticsModule } from './modules/logistics/logistics.module.js';
import { FiscalModule } from './modules/fiscal/fiscal.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { SupportModule } from './modules/support/support.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';

// pino-pretty é dependência de desenvolvimento: só é carregado quando pedido explicitamente.
const prettyLogs = process.env.LOG_PRETTY === 'true';

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        genReqId: (req) => (req as { id?: string }).id ?? 'unknown',
        customProps: () => {
          const store = requestContext.getStore();
          return {
            correlationId: store?.correlationId,
            userId: store?.auth?.userId,
            tenantId: store?.auth?.membership?.tenantId,
          };
        },
        redact: {
          paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'],
          censor: '[redacted]',
        },
        autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
        transport: prettyLogs ? { target: 'pino-pretty', options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' } } : undefined,
      },
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    InfraModule,
    AuthModule,
    PlatformModule,
    UploadsModule,
    OrdersModule,
    RegistryModule,
    CommercialModule,
    LogisticsModule,
    FiscalModule,
    DashboardModule,
    NotificationsModule,
    SupportModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalErrorFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
