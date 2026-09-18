import { ErrorCode, type FleetRefs } from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import { AppError } from '../../common/errors.js';

export interface FleetInput {
  carrierPartnerId?: string | null;
  driverId?: string | null;
  tractorVehicleId?: string | null;
  trailerVehicleId?: string | null;
  secondTrailerVehicleId?: string | null;
}

const TRACTOR_TYPES = ['TRUCK_TRACTOR', 'TRUCK'];
const TRAILER_TYPES = ['TRAILER', 'SEMI_TRAILER', 'BITRAIN', 'ROAD_TRAIN'];

/** Valida transportadora, motorista e composição; retorna dados normalizados e placas. */
export async function resolveFleet(tx: Tx, input: FleetInput) {
  const fields: Record<string, string[]> = {};
  const carrierId = input.carrierPartnerId ?? null;

  if (carrierId) {
    const role = await tx.partnerRoleAssignment.findFirst({ where: { partnerId: carrierId, role: 'CARRIER' } });
    if (!role) fields.carrierPartnerId = ['Parceiro não é transportadora'];
  }

  if (input.driverId) {
    const d = await tx.driver.findUnique({ where: { id: input.driverId } });
    if (!d || d.archivedAt) fields.driverId = ['Motorista não encontrado'];
    else {
      if (d.status !== 'ACTIVE') fields.driverId = ['Motorista inativo ou bloqueado'];
      else if (d.cnhExpiresAt && d.cnhExpiresAt.getTime() < Date.now()) fields.driverId = [`CNH de ${d.name} vencida`];
      else if (carrierId && d.carrierPartnerId && d.carrierPartnerId !== carrierId) fields.driverId = ['Motorista de outra transportadora'];
    }
  }

  const ids = [input.tractorVehicleId, input.trailerVehicleId, input.secondTrailerVehicleId].filter((v): v is string => Boolean(v));
  const vehicles = ids.length ? await tx.vehicle.findMany({ where: { id: { in: ids } } }) : [];
  const byId = new Map(vehicles.map((v) => [v.id, v]));
  const check = (id: string | null | undefined, key: string, types: string[], label: string) => {
    if (!id) return;
    const v = byId.get(id);
    if (!v || v.archivedAt) return (fields[key] = ['Veículo não encontrado']);
    if (v.status !== 'ACTIVE') return (fields[key] = [`${v.plate} está inativo ou bloqueado`]);
    if (!types.includes(v.type)) return (fields[key] = [`${v.plate} não é ${label}`]);
    if (carrierId && v.carrierPartnerId && v.carrierPartnerId !== carrierId) fields[key] = [`${v.plate} pertence a outra transportadora`];
  };
  check(input.tractorVehicleId, 'tractorVehicleId', TRACTOR_TYPES, 'cavalo mecânico ou caminhão');
  check(input.trailerVehicleId, 'trailerVehicleId', TRAILER_TYPES, 'carreta/implemento');
  check(input.secondTrailerVehicleId, 'secondTrailerVehicleId', TRAILER_TYPES, 'carreta/implemento');
  if (input.secondTrailerVehicleId && !input.trailerVehicleId) fields.secondTrailerVehicleId = ['Informe a primeira carreta antes da segunda'];
  if (new Set(ids).size !== ids.length) fields.trailerVehicleId = ['O mesmo veículo foi informado mais de uma vez'];

  if (Object.keys(fields).length) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Verifique a transportadora, o motorista e os veículos.', { fields });

  return {
    carrierPartnerId: carrierId,
    driverId: input.driverId ?? null,
    tractorVehicleId: input.tractorVehicleId ?? null,
    trailerVehicleId: input.trailerVehicleId ?? null,
    secondTrailerVehicleId: input.secondTrailerVehicleId ?? null,
    plates: ids.map((id) => byId.get(id)!.plate),
  };
}

interface FleetColumns {
  carrierPartnerId: string | null;
  driverId: string | null;
  tractorVehicleId: string | null;
  trailerVehicleId: string | null;
  secondTrailerVehicleId: string | null;
  plates: string[];
}

/** Carrega nomes de transportadoras, motoristas e placas para uma lista de registros (sem N+1). */
export async function fleetRefs<T extends FleetColumns>(tx: Tx, rows: T[]): Promise<(row: T) => FleetRefs> {
  const carrierIds = [...new Set(rows.map((r) => r.carrierPartnerId).filter((v): v is string => Boolean(v)))];
  const driverIds = [...new Set(rows.map((r) => r.driverId).filter((v): v is string => Boolean(v)))];
  const vehicleIds = [...new Set(rows.flatMap((r) => [r.tractorVehicleId, r.trailerVehicleId, r.secondTrailerVehicleId]).filter((v): v is string => Boolean(v)))];
  const [carriers, drivers, vehicles] = await Promise.all([
    carrierIds.length ? tx.businessPartner.findMany({ where: { id: { in: carrierIds } }, select: { id: true, legalName: true, tradeName: true } }) : [],
    driverIds.length ? tx.driver.findMany({ where: { id: { in: driverIds } }, select: { id: true, name: true, cnhExpiresAt: true } }) : [],
    vehicleIds.length ? tx.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, plate: true } }) : [],
  ]);
  const c = new Map(carriers.map((x) => [x.id, x]));
  const d = new Map(drivers.map((x) => [x.id, x]));
  const v = new Map(vehicles.map((x) => [x.id, x]));
  const plate = (id: string | null) => (id && v.get(id) ? { id, plate: v.get(id)!.plate } : null);
  return (row) => {
    const carrier = row.carrierPartnerId ? c.get(row.carrierPartnerId) : undefined;
    const driver = row.driverId ? d.get(row.driverId) : undefined;
    return {
      carrier: carrier ? { id: carrier.id, name: carrier.tradeName ?? carrier.legalName } : null,
      driver: driver
        ? { id: driver.id, name: driver.name, cnhStatus: driver.cnhExpiresAt && driver.cnhExpiresAt.getTime() < Date.now() ? 'EXPIRED' : 'OK' }
        : null,
      tractor: plate(row.tractorVehicleId),
      trailer: plate(row.trailerVehicleId),
      secondTrailer: plate(row.secondTrailerVehicleId),
      plates: row.plates,
    };
  };
}

export interface OrderForLogistics {
  id: string;
  tenantId: string;
  number: string;
  status: string;
  releasedQty: Prisma.Decimal;
  scheduledQty: Prisma.Decimal;
  loadedQty: Prisma.Decimal;
  tolerancePct: Prisma.Decimal;
  unitFactorToKg: Prisma.Decimal;
  unitCode: string;
}

/** Ordem apta a operações logísticas (publicada ou em execução), com fator de conversão da unidade. */
export async function orderForLogistics(tx: Tx, orderId: string): Promise<OrderForLogistics> {
  // Bloqueia a ordem até o fim da transação: quem consome saldo liberado (agendamento, carga, pesagem)
  // lê os totais já serializado, evitando que requisições simultâneas ultrapassem o liberado (revisão 3.2).
  await tx.$queryRaw`select id from loading_orders where id = ${orderId}::uuid for update`;
  const order = await tx.loadingOrder.findUnique({ where: { id: orderId } });
  if (!order) throw AppError.notFound('Ordem não encontrada.');
  if (!['PUBLISHED', 'IN_PROGRESS'].includes(order.status)) {
    throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'Agendamentos e cargas só podem ser registrados em ordens publicadas ou em execução.');
  }
  const unit = order.unitId ? await tx.unit.findUnique({ where: { id: order.unitId } }) : null;
  return {
    id: order.id,
    tenantId: order.tenantId,
    number: order.number,
    status: order.status,
    releasedQty: order.releasedQty,
    scheduledQty: order.scheduledQty,
    loadedQty: order.loadedQty,
    tolerancePct: order.tolerancePct,
    unitFactorToKg: unit?.factorToKg ?? new Prisma.Decimal(1),
    unitCode: unit?.code ?? 'T',
  };
}

/** Recalcula totais da ordem a partir de agendamentos e cargas (função SQL, mesma transação). */
export async function recalcOrder(tx: Tx, orderId: string) {
  // $executeRaw: a função retorna void (não desserializável por $queryRaw).
  await tx.$executeRaw`select recalc_order_quantities(${orderId}::uuid)`;
  return tx.loadingOrder.findUniqueOrThrow({ where: { id: orderId } });
}

/**
 * Garante que agendado + carregado + novo ≤ liberado × (1 + tolerância).
 * `freed` desconta a quantidade do próprio registro quando ele já está contabilizado.
 */
type DecimalLike = Prisma.Decimal | string | number;

export function assertWithinReleased(
  order: { releasedQty: Prisma.Decimal; scheduledQty: Prisma.Decimal; loadedQty: Prisma.Decimal; tolerancePct: Prisma.Decimal },
  adding: DecimalLike,
  freed: DecimalLike = 0,
) {
  const max = new Prisma.Decimal(order.releasedQty).times(new Prisma.Decimal(order.tolerancePct).dividedBy(100).plus(1));
  const used = new Prisma.Decimal(order.scheduledQty).plus(order.loadedQty).minus(freed);
  const available = Prisma.Decimal.max(max.minus(used), 0);
  if (new Prisma.Decimal(adding).greaterThan(available)) {
    throw AppError.domain(ErrorCode.QUANTITY_EXCEEDS_RELEASED, `Quantidade acima do saldo liberado disponível (${available.toString()}).`, {
      fields: { expectedQty: [`Disponível: ${available.toString()}`] },
      available: available.toString(),
    });
  }
}
