import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  loadTransitionSchema,
  loadUpdateSchema,
  logisticsListQuery,
  type LogisticsListQuery,
  type TransportSuggestions,
} from '@ordens/contracts';
import { Prisma } from '@ordens/db';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { readVehicles } from './logistics.util.js';
import { LoadsService } from './loads.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const listPipe = new ZodPipe(logisticsListQuery);
const arrivalSchema = z.strictObject({ orderId: z.uuid() });

@ApiTags('logística')
@Controller('loads')
export class LoadsController {
  constructor(private readonly loads: LoadsService) {}

  @Get()
  @RequirePermission('load.read')
  list(@Query(listPipe) q: LogisticsListQuery) {
    return this.loads.list(q);
  }

  @Get(':id')
  @RequirePermission('load.read')
  detail(@Param('id', uuid) id: string) {
    return this.loads.detail(id);
  }

  /** A Fazenda informa a chegada do caminhão; a carga nasce daqui. */
  @Post('arrival')
  @RequirePermission('load.manage')
  arrival(@Body(new ZodPipe(arrivalSchema)) body: z.output<typeof arrivalSchema>) {
    return this.loads.registerArrival(body.orderId);
  }

  @Patch(':id')
  @RequirePermission('load.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(loadUpdateSchema)) body: z.output<typeof loadUpdateSchema>) {
    return this.loads.update(id, body);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermission('load.manage')
  transition(@Param('id', uuid) id: string, @Body(new ZodPipe(loadTransitionSchema)) body: z.output<typeof loadTransitionSchema>) {
    return this.loads.transition(id, body);
  }
}

const suggestionsQuery = z.object({ q: z.string().trim().max(120).optional() });

/**
 * Sugestões para os campos digitáveis de transporte: tudo o que já foi digitado nas cargas
 * visíveis a quem pergunta. Como a leitura passa pelo RLS, cada grupo só recebe o que é dele — não
 * há cadastro compartilhado nem risco de um comprador ver os motoristas de outro.
 */
@ApiTags('logística')
@Controller('transport')
export class TransportSuggestionsController {
  constructor(private readonly db: TenantDb) {}

  @Get('suggestions')
  @RequirePermission('load.read')
  suggestions(@Query(new ZodPipe(suggestionsQuery)) q: z.infer<typeof suggestionsQuery>): Promise<TransportSuggestions> {
    const like = q.q ? `%${q.q.replace(/[%_]/g, (m) => `\\${m}`)}%` : null;
    return this.db.read(async (tx) => {
      const [carriers, drivers, vehicles] = await Promise.all([
        tx.$queryRaw<{ carrier_name: string }[]>(Prisma.sql`
          select distinct carrier_name from loads
          where carrier_name is not null ${like ? Prisma.sql`and carrier_name ilike ${like}` : Prisma.empty}
          order by carrier_name limit 50
        `),
        // Uma linha por CPF, com o que foi digitado mais recentemente para aquele motorista.
        tx.$queryRaw<DriverSuggestionRow[]>(Prisma.sql`
          select distinct on (driver_cpf)
            driver_name, driver_cpf, driver_rg, driver_phone, driver_birth_date,
            driver_cnh, driver_cnh_category, driver_cnh_expires_at, driver_cnh_restrictions, carrier_name
          from loads
          where driver_cpf is not null
            ${like ? Prisma.sql`and (driver_name ilike ${like} or driver_cpf like ${like})` : Prisma.empty}
          order by driver_cpf, created_at desc limit 50
        `),
        tx.$queryRaw<{ vehicle: Prisma.JsonValue }[]>(Prisma.sql`
          select distinct on (vehicle->>'plate') vehicle
          from loads a, jsonb_array_elements(a.vehicles) as vehicle
          where ${like ? Prisma.sql`vehicle->>'plate' ilike ${like}` : Prisma.sql`true`}
          order by vehicle->>'plate', a.created_at desc limit 50
        `),
      ]);
      const day = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);
      return {
        carriers: carriers.map((c) => c.carrier_name),
        drivers: drivers.map((d) => ({
          driverName: d.driver_name,
          driverCpf: d.driver_cpf,
          driverRg: d.driver_rg,
          driverPhone: d.driver_phone,
          driverBirthDate: day(d.driver_birth_date),
          driverCnh: d.driver_cnh,
          driverCnhCategory: d.driver_cnh_category,
          driverCnhExpiresAt: day(d.driver_cnh_expires_at),
          driverCnhRestrictions: d.driver_cnh_restrictions,
          carrierName: d.carrier_name,
        })),
        vehicles: vehicles.flatMap((v) => readVehicles([v.vehicle])),
      };
    });
  }
}

interface DriverSuggestionRow {
  driver_name: string | null;
  driver_cpf: string | null;
  driver_rg: string | null;
  driver_phone: string | null;
  driver_birth_date: Date | null;
  driver_cnh: string | null;
  driver_cnh_category: string | null;
  driver_cnh_expires_at: Date | null;
  driver_cnh_restrictions: string | null;
  carrier_name: string | null;
}

@Module({
  controllers: [LoadsController, TransportSuggestionsController],
  providers: [LoadsService],
})
export class LogisticsModule {}
