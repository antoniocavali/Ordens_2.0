import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  appointmentInputSchema,
  appointmentTransitionSchema,
  cursorQuery,
  loadInputSchema,
  loadTransitionSchema,
  loadUpdateSchema,
  logisticsListQuery,
  type CursorPage,
  type LogisticsListQuery,
  type LookupOption,
} from '@ordens/contracts';
import { Prisma } from '@ordens/db';
import { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { AppointmentsService } from './appointments.service.js';
import { LoadsService } from './loads.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });
const listPipe = new ZodPipe(logisticsListQuery);

@ApiTags('logística')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  @RequirePermission('appointment.read')
  list(@Query(listPipe) q: LogisticsListQuery) {
    return this.appointments.list(q);
  }

  @Post()
  @RequirePermission('appointment.manage')
  create(@Body(new ZodPipe(appointmentInputSchema)) body: z.output<typeof appointmentInputSchema>) {
    return this.appointments.create(body);
  }

  @Put(':id')
  @RequirePermission('appointment.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(appointmentInputSchema)) body: z.output<typeof appointmentInputSchema>) {
    return this.appointments.update(id, body);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @RequirePermission('appointment.manage')
  transition(@Param('id', uuid) id: string, @Body(new ZodPipe(appointmentTransitionSchema)) body: z.output<typeof appointmentTransitionSchema>) {
    return this.appointments.transition(id, body.to, body.reason);
  }
}

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

  @Post()
  @RequirePermission('load.manage')
  create(@Body(new ZodPipe(loadInputSchema)) body: z.output<typeof loadInputSchema>) {
    return this.loads.create(body);
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

const fleetLookupQuery = cursorQuery.extend({ carrierId: z.uuid().optional(), kind: z.enum(['tractor', 'trailer']).optional() });

/** Buscas de frota para comboboxes de agendamento/carga. */
@ApiTags('logística')
@Controller('lookups')
export class FleetLookupsController {
  constructor(private readonly db: TenantDb) {}

  @Get('drivers')
  @RequirePermission('carrier.read')
  drivers(@Query(new ZodPipe(fleetLookupQuery)) q: z.infer<typeof fleetLookupQuery>): Promise<CursorPage<LookupOption>> {
    return this.db.read(async (tx) => {
      const rows = await tx.driver.findMany({
        where: {
          archivedAt: null,
          status: 'ACTIVE',
          ...(q.carrierId ? { OR: [{ carrierPartnerId: q.carrierId }, { carrierPartnerId: null }] } : {}),
          ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
        },
        orderBy: { name: 'asc' },
        take: 50,
      });
      return {
        nextCursor: null,
        items: rows.map((d) => {
          const expired = d.cnhExpiresAt ? d.cnhExpiresAt.getTime() < Date.now() : false;
          return { id: d.id, label: d.name, description: `CNH ${d.cnhCategory ?? '—'}${expired ? ' · VENCIDA' : ''}`, meta: { carrierId: d.carrierPartnerId, expired: String(expired) } };
        }),
      };
    });
  }

  @Get('vehicles')
  @RequirePermission('carrier.read')
  vehicles(@Query(new ZodPipe(fleetLookupQuery)) q: z.infer<typeof fleetLookupQuery>): Promise<CursorPage<LookupOption>> {
    return this.db.read(async (tx) => {
      const types = q.kind === 'tractor' ? ['TRUCK_TRACTOR', 'TRUCK'] : q.kind === 'trailer' ? ['TRAILER', 'SEMI_TRAILER', 'BITRAIN', 'ROAD_TRAIN'] : undefined;
      const rows = await tx.vehicle.findMany({
        where: {
          archivedAt: null,
          status: 'ACTIVE',
          ...(types ? { type: { in: types as Prisma.EnumVehicleTypeFilter['in'] } } : {}),
          ...(q.carrierId ? { carrierPartnerId: q.carrierId } : {}),
          ...(q.q ? { plate: { contains: q.q.toUpperCase().replace(/[^A-Z0-9]/g, '') } } : {}),
        },
        orderBy: { plate: 'asc' },
        take: 50,
      });
      return {
        nextCursor: null,
        items: rows.map((v) => ({ id: v.id, label: v.plate, description: [v.brand, v.model].filter(Boolean).join(' ') || v.type, meta: { carrierId: v.carrierPartnerId, type: v.type } })),
      };
    });
  }
}

@Module({
  controllers: [AppointmentsController, LoadsController, FleetLookupsController],
  providers: [AppointmentsService, LoadsService],
})
export class LogisticsModule {}
