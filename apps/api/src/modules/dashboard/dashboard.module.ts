import { Controller, Get, Module, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { dashboardQuery, type DashboardQuery } from '@ordens/contracts';
import { ZodPipe } from '../../common/zod.pipe.js';
import { DashboardService } from './dashboard.service.js';

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

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
