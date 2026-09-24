import { Injectable } from '@nestjs/common';
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_TRANSITIONS,
  appointmentInputSchema,
  ErrorCode,
  type AppointmentDto,
  type AppointmentStatus,
  type CnhCategory,
  type LogisticsListQuery,
  type Page,
} from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import type { z } from 'zod';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { fromDate, toDate } from '../registry/registry.util.js';
import {
  assertWithinReleased,
  orderForLogistics,
  readVehicles,
  recalcOrder,
  resolveTransport,
  transportDto,
  type TransportColumns,
  type TransportInput,
} from './logistics.util.js';
import { LoadsService } from './loads.service.js';

type AppointmentData = z.output<typeof appointmentInputSchema>;
type AppointmentRow = NonNullable<Awaited<ReturnType<Tx['appointment']['findUnique']>>>;

const ACTIVE: AppointmentStatus[] = ['REQUESTED', 'CONFIRMED', 'CHECKED_IN'];

/** Transporte da ordem no formato do input do agendamento (datas como AAAA-MM-DD). */
function transportOf(order: TransportColumns): TransportInput {
  const { plates: _plates, cnhStatus: _cnhStatus, ...dto } = transportDto(order);
  return { ...dto, driverCnhCategory: dto.driverCnhCategory as CnhCategory | null };
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly loads: LoadsService,
  ) {}

  list(q: LogisticsListQuery): Promise<Page<AppointmentDto>> {
    return this.db.read(async (tx) => {
      const where: Prisma.AppointmentWhereInput = {
        ...(q.orderId ? { orderId: q.orderId } : {}),
        ...(q.status?.length ? { status: { in: q.status as AppointmentStatus[] } } : {}),
        ...(q.carrier ? { carrierName: q.carrier } : {}),
        ...(q.from || q.to ? { scheduledOn: { ...(q.from ? { gte: toDate(q.from)! } : {}), ...(q.to ? { lte: toDate(q.to)! } : {}) } } : {}),
        ...(q.q
          ? {
              OR: [
                { order: { number: { contains: q.q } } },
                { plates: { has: q.q.toUpperCase().replace(/[^A-Z0-9]/g, '') } },
                { driverName: { contains: q.q, mode: 'insensitive' as const } },
                { carrierName: { contains: q.q, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      };
      const [total, rows] = await Promise.all([
        tx.appointment.count({ where }),
        tx.appointment.findMany({
          where,
          include: { load: { select: { id: true } } },
          orderBy: [{ scheduledOn: 'asc' }, { windowStart: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return { total, page: q.page, pageSize: q.pageSize, items: await this.toDtos(tx, rows) };
    });
  }

  create(input: AppointmentData): Promise<AppointmentDto> {
    return this.db.write(async ({ tx, audit, outbox }) => {
      const order = await orderForLogistics(tx, input.orderId);
      const fresh = await recalcOrder(tx, order.id);
      assertWithinReleased(fresh, input.expectedQty);
      // O transporte é digitado na ordem (o Comprador informa ao solicitar): sem motorista nem
      // veículo no agendamento, ele nasce com o da ordem, que ainda pode ser corrigido na portaria.
      const transport = resolveTransport(input.driverName || input.vehicles?.length ? input : transportOf(fresh));
      const row = await tx.appointment.create({
        data: {
          tenantId: order.tenantId,
          orderId: order.id,
          scheduledOn: toDate(input.scheduledOn)!,
          windowStart: input.windowStart ?? null,
          windowEnd: input.windowEnd ?? null,
          expectedQty: input.expectedQty,
          notes: input.notes ?? null,
          createdBy: currentAuth().userId,
          ...transport,
        },
      });
      await recalcOrder(tx, order.id);
      await audit({ entityType: 'appointment', entityId: row.id, action: 'appointment.created', after: { ...input, plates: transport.plates } });
      await audit({
        entityType: 'loading_order',
        entityId: order.id,
        action: 'order.appointment_created',
        after: { scheduledOn: input.scheduledOn, quantity: input.expectedQty, plates: transport.plates },
      });
      await outbox({ type: 'appointment.created', aggregateType: 'appointment', aggregateId: row.id, payload: { appointmentId: row.id, orderId: order.id, scheduledOn: input.scheduledOn } });
      return this.dto(tx, row.id);
    });
  }

  update(id: string, input: AppointmentData): Promise<AppointmentDto> {
    return this.db.write(async ({ tx, audit }) => {
      const before = await tx.appointment.findUnique({ where: { id } });
      if (!before) throw AppError.notFound('Agendamento não encontrado.');
      if (!['REQUESTED', 'CONFIRMED'].includes(before.status)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Somente agendamentos solicitados ou confirmados podem ser editados.');
      }
      if (before.orderId !== input.orderId) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'O agendamento não pode mudar de ordem.');
      const order = await recalcOrder(tx, before.orderId);
      assertWithinReleased(order, input.expectedQty, before.expectedQty);
      const transport = resolveTransport(input);
      await tx.appointment.update({
        where: { id },
        data: {
          scheduledOn: toDate(input.scheduledOn)!,
          windowStart: input.windowStart ?? null,
          windowEnd: input.windowEnd ?? null,
          expectedQty: input.expectedQty,
          notes: input.notes ?? null,
          ...transport,
        },
      });
      await recalcOrder(tx, before.orderId);
      await audit({
        entityType: 'appointment',
        entityId: id,
        action: 'appointment.updated',
        before: { scheduledOn: fromDate(before.scheduledOn), expectedQty: before.expectedQty.toString(), plates: before.plates, driverName: before.driverName },
        after: { scheduledOn: input.scheduledOn, expectedQty: input.expectedQty, plates: transport.plates, driverName: transport.driverName },
      });
      return this.dto(tx, id);
    });
  }

  transition(id: string, to: AppointmentStatus, reason: string | null | undefined): Promise<AppointmentDto> {
    return this.db.write(async (scope) => {
      const { tx, audit, outbox } = scope;
      const row = await tx.appointment.findUnique({ where: { id } });
      if (!row) throw AppError.notFound('Agendamento não encontrado.');
      if (!APPOINTMENT_TRANSITIONS[row.status].includes(to)) {
        throw AppError.domain(ErrorCode.INVALID_TRANSITION, `Não é possível passar de "${APPOINTMENT_STATUS_LABELS[row.status]}" para "${APPOINTMENT_STATUS_LABELS[to]}".`);
      }
      if ((to === 'CANCELLED' || to === 'NO_SHOW') && !reason) {
        throw AppError.validation({ fields: { reason: ['Informe o motivo'] } }, 'Informe o motivo.');
      }
      if (to === 'CONFIRMED') {
        const vehicles = readVehicles(row.vehicles);
        if (!row.driverName || !vehicles.length) {
          throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Para confirmar, informe o motorista e ao menos um veículo.', {
            fields: { driverName: row.driverName ? [] : ['Obrigatório para confirmar'], vehicles: vehicles.length ? [] : ['Informe ao menos um veículo'] },
          });
        }
        // A CNH digitada continua sendo conferida: vencida na data do carregamento não confirma.
        if (row.driverCnhExpiresAt && row.driverCnhExpiresAt < row.scheduledOn) {
          throw AppError.domain(ErrorCode.VALIDATION_FAILED, `A CNH de ${row.driverName} vence antes da data do carregamento.`, {
            fields: { driverCnhExpiresAt: ['CNH vencida para esta data'] },
          });
        }
      }

      if (to === 'CONVERTED') {
        await this.loads.createInScope(scope, {
          orderId: row.orderId,
          appointmentId: row.id,
          loadingDate: fromDate(row.scheduledOn),
          expectedQty: row.expectedQty.toString(),
          carrierName: row.carrierName,
          driverName: row.driverName,
          driverCpf: row.driverCpf,
          driverRg: row.driverRg,
          driverPhone: row.driverPhone,
          driverBirthDate: fromDate(row.driverBirthDate),
          driverCnh: row.driverCnh,
          // A coluna é texto; o valor veio do próprio enum do contrato na gravação do agendamento.
          driverCnhCategory: row.driverCnhCategory as CnhCategory | null,
          driverCnhExpiresAt: fromDate(row.driverCnhExpiresAt),
          driverCnhRestrictions: row.driverCnhRestrictions,
          vehicles: readVehicles(row.vehicles),
          notes: row.notes,
        });
      } else {
        await tx.appointment.update({ where: { id }, data: { status: to, ...(reason ? { cancelReason: reason } : {}) } });
        await recalcOrder(tx, row.orderId);
      }
      await audit({ entityType: 'appointment', entityId: id, action: 'appointment.status_changed', before: { status: row.status }, after: { status: to, reason: reason ?? null } });
      await outbox({ type: 'appointment.status_changed', aggregateType: 'appointment', aggregateId: id, payload: { appointmentId: id, orderId: row.orderId, from: row.status, to } });
      return this.dto(tx, id);
    });
  }

  private async dto(tx: Tx, id: string): Promise<AppointmentDto> {
    const row = await tx.appointment.findUnique({ where: { id }, include: { load: { select: { id: true } } } });
    if (!row) throw AppError.notFound('Agendamento não encontrado.');
    return (await this.toDtos(tx, [row]))[0]!;
  }

  private async toDtos(tx: Tx, rows: (AppointmentRow & { load: { id: string } | null })[]): Promise<AppointmentDto[]> {
    if (!rows.length) return [];
    const orderIds = [...new Set(rows.map((r) => r.orderId))];
    const orders = await tx.$queryRaw<{ id: string; number: string; commodity: string | null; farm: string | null; unit: string | null }[]>(Prisma.sql`
      select lo.id, lo.number, c.name as commodity, f.name as farm, u.code as unit
      from loading_orders lo
      left join commodities c on c.id = lo.commodity_id
      left join farms f on f.id = lo.farm_id
      left join units u on u.id = lo.unit_id
      where lo.id in (${Prisma.join(orderIds.map((o) => Prisma.sql`${o}::uuid`))})
    `);
    const orderMap = new Map(orders.map((o) => [o.id, o]));
    const users = await tx.user.findMany({ where: { id: { in: rows.map((r) => r.createdBy).filter((v): v is string => Boolean(v)) } }, select: { id: true, name: true } });
    const userMap = new Map(users.map((u) => [u.id, u.name]));
    const canManage = currentAuth().permissions.has('appointment.manage');

    return rows.map((r) => {
      const o = orderMap.get(r.orderId);
      return {
        id: r.id,
        order: { id: r.orderId, number: o?.number ?? '', commodity: o?.commodity ?? null, farm: o?.farm ?? null, unit: o?.unit === 'T' ? 't' : (o?.unit?.toLowerCase() ?? '') },
        scheduledOn: fromDate(r.scheduledOn)!,
        windowStart: r.windowStart,
        windowEnd: r.windowEnd,
        expectedQty: r.expectedQty.toString(),
        status: r.status,
        loadId: r.load?.id ?? null,
        notes: r.notes,
        createdBy: r.createdBy ? (userMap.get(r.createdBy) ?? null) : null,
        updatedAt: r.updatedAt.toISOString(),
        allowedTransitions: canManage && ACTIVE.includes(r.status) || r.status === 'REQUESTED' ? (canManage ? [...APPOINTMENT_TRANSITIONS[r.status]] : []) : [],
        ...transportDto(r),
      };
    });
  }
}
