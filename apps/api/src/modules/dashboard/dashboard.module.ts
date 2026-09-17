import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { dashboardQuery, reportQuerySchema, type DashboardQuery, type ReportQuery } from '@ordens/contracts';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DashboardService } from './dashboard.service.js';
import { ManagementService } from './management.service.js';

@ApiTags('painéis')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Permissão verificada no serviço: basta uma de dashboard.matriz/farm/buyer compatível com o escopo ativo. */
  @Get()
  get(@Query(new ZodPipe(dashboardQuery)) q: DashboardQuery) {
    return this.dashboard.get(q);
  }
}

/** Painel de Gestão (Q46): tempos do ciclo da ordem. Período padrão: últimos 90 dias. */
@ApiTags('painéis')
@Controller('management')
export class ManagementController {
  constructor(private readonly management: ManagementService) {}

  @Get('cycle')
  cycle(@Query(new ZodPipe(reportQuerySchema)) q: ReportQuery) {
    const today = new Date();
    const to = q.to ?? today.toISOString().slice(0, 10);
    const from = q.from ?? new Date(today.getTime() - 89 * 86_400_000).toISOString().slice(0, 10);
    return this.management.cycle({ ...q, from, to });
  }
}

@Module({
  controllers: [DashboardController, ManagementController],
  providers: [DashboardService, ManagementService],
})
export class DashboardModule {}
