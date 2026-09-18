import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  dashboardQuery,
  managementOrdersQuery,
  reportQuerySchema,
  type DashboardQuery,
  type ManagementOrdersQuery,
  type ReportQuery,
} from '@ordens/contracts';
import { RequireAnyPermission, RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DashboardService } from './dashboard.service.js';
import { ManagementService } from './management.service.js';

@ApiTags('painéis')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Permissão verificada no serviço: basta uma de dashboard.matriz/farm/buyer compatível com o escopo ativo. */
  @Get()
  @RequireAnyPermission('dashboard.matriz', 'dashboard.farm', 'dashboard.buyer')
  get(@Query(new ZodPipe(dashboardQuery)) q: DashboardQuery) {
    return this.dashboard.get(q);
  }
}

/** Período padrão do painel: últimos 90 dias. */
function period(q: { from?: string; to?: string }) {
  const today = new Date();
  return {
    from: q.from ?? new Date(today.getTime() - 89 * 86_400_000).toISOString().slice(0, 10),
    to: q.to ?? today.toISOString().slice(0, 10),
  };
}

/** Painel de Gestão (Q46): tempos do ciclo da ordem. */
@ApiTags('painéis')
@RequirePermission('dashboard.matriz')
@Controller('management')
export class ManagementController {
  constructor(private readonly management: ManagementService) {}

  @Get('cycle')
  cycle(@Query(new ZodPipe(reportQuerySchema)) q: ReportQuery) {
    return this.management.cycle({ ...q, ...period(q) });
  }

  /** Tempo por ordem, paginado. */
  @Get('cycle/orders')
  orders(@Query(new ZodPipe(managementOrdersQuery)) q: ManagementOrdersQuery) {
    return this.management.orders({ ...q, ...period(q) });
  }
}

@Module({
  controllers: [DashboardController, ManagementController],
  providers: [DashboardService, ManagementService],
})
export class DashboardModule {}
