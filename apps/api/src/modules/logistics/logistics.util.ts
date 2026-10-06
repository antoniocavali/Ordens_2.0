import { ErrorCode, type CnhStatus, type TransportDto, type TransportVehicle, transportVehicleSchema } from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import { AppError } from '../../common/errors.js';

export interface TransportInput {
  carrierName?: string | null;
  driverName?: string | null;
  driverCpf?: string | null;
  driverRg?: string | null;
  driverPhone?: string | null;
  driverBirthDate?: string | null;
  driverCnh?: string | null;
  driverCnhCategory?: string | null;
  driverCnhExpiresAt?: string | null;
  driverCnhRestrictions?: string | null;
  vehicles?: TransportVehicle[] | null;
}

/** Colunas de transporte gravadas na ordem e na carga (mesmo formato). */
export interface TransportColumns {
  carrierName: string | null;
  driverName: string | null;
  driverCpf: string | null;
  driverRg: string | null;
  driverPhone: string | null;
  driverBirthDate: Date | null;
  driverCnh: string | null;
  driverCnhCategory: string | null;
  driverCnhExpiresAt: Date | null;
  driverCnhRestrictions: string | null;
  vehicles: Prisma.JsonValue;
  /** A ordem não guarda placas: elas são derivadas da composição. */
  plates?: string[];
}

const date = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

/**
 * Normaliza o transporte digitado para gravação. O Zod do contrato já validou placa, CPF, CNH e
 * duplicidade; aqui só derivamos as placas (usadas em busca e na portaria) a partir da composição.
 */
export function resolveTransport(input: TransportInput) {
  const vehicles = (input.vehicles ?? []).map((v) => ({
    plate: v.plate,
    description: v.description ?? null,
    type: v.type,
    axles: v.axles ?? null,
    renavam: v.renavam ?? null,
  }));
  return {
    carrierName: input.carrierName ?? null,
    driverName: input.driverName ?? null,
    driverCpf: input.driverCpf ?? null,
    driverRg: input.driverRg ?? null,
    driverPhone: input.driverPhone ?? null,
    driverBirthDate: date(input.driverBirthDate),
    driverCnh: input.driverCnh ?? null,
    driverCnhCategory: input.driverCnhCategory ?? null,
    driverCnhExpiresAt: date(input.driverCnhExpiresAt),
    driverCnhRestrictions: input.driverCnhRestrictions ?? null,
    vehicles: vehicles as unknown as Prisma.InputJsonValue,
    plates: vehicles.map((v) => v.plate),
  };
}

/** CNH vencida bloqueia; a menos de 30 dias do vencimento, avisa. */
export function cnhStatus(expiresAt: Date | null, reference = new Date()): CnhStatus {
  if (!expiresAt) return 'UNKNOWN';
  const days = Math.floor((expiresAt.getTime() - reference.getTime()) / 86_400_000);
  if (days < 0) return 'EXPIRED';
  return days <= 30 ? 'EXPIRING' : 'OK';
}

const iso = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : null);

/** Lê a composição do jsonb descartando o que não tem o formato esperado (dado antigo ou manual). */
export function readVehicles(value: Prisma.JsonValue): TransportVehicle[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = transportVehicleSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Monta o transporte para resposta da API a partir das colunas da tabela. */
export function transportDto(row: TransportColumns): TransportDto {
  return {
    carrierName: row.carrierName,
    driverName: row.driverName,
    driverCpf: row.driverCpf,
    driverRg: row.driverRg,
    driverPhone: row.driverPhone,
    driverBirthDate: iso(row.driverBirthDate),
    driverCnh: row.driverCnh,
    driverCnhCategory: row.driverCnhCategory,
    driverCnhExpiresAt: iso(row.driverCnhExpiresAt),
    driverCnhRestrictions: row.driverCnhRestrictions,
    cnhStatus: cnhStatus(row.driverCnhExpiresAt),
    vehicles: readVehicles(row.vehicles),
    plates: row.plates ?? readVehicles(row.vehicles).map((v) => v.plate),
  };
}

export interface OrderForLogistics {
  id: string;
  tenantId: string;
  number: string;
  status: string;
  loadedQty: Prisma.Decimal;
  tolerancePct: Prisma.Decimal;
  unitFactorToKg: Prisma.Decimal;
  unitCode: string;
}

/** Ordem apta a operações logísticas (publicada ou em execução), com fator de conversão da unidade. */
export async function orderForLogistics(tx: Tx, orderId: string): Promise<OrderForLogistics> {
  // Bloqueia a ordem até o fim da transação: duas chegadas simultâneas não pegam o mesmo número de carga.
  await tx.$queryRaw`select id from loading_orders where id = ${orderId}::uuid for update`;
  const order = await tx.loadingOrder.findUnique({ where: { id: orderId } });
  if (!order) throw AppError.notFound('Ordem não encontrada.');
  if (!['PUBLISHED', 'IN_PROGRESS'].includes(order.status)) {
    throw AppError.domain(ErrorCode.INVALID_TRANSITION, 'A chegada do caminhão só pode ser informada em ordens publicadas ou em execução.');
  }
  const unit = order.unitId ? await tx.unit.findUnique({ where: { id: order.unitId } }) : null;
  return {
    id: order.id,
    tenantId: order.tenantId,
    number: order.number,
    status: order.status,
    loadedQty: order.loadedQty,
    tolerancePct: order.tolerancePct,
    unitFactorToKg: unit?.factorToKg ?? new Prisma.Decimal(1),
    unitCode: unit?.code ?? 'T',
  };
}

/** Recalcula totais da ordem a partir das cargas (função SQL, mesma transação). */
export async function recalcOrder(tx: Tx, orderId: string) {
  // $executeRaw: a função retorna void (não desserializável por $queryRaw).
  await tx.$executeRaw`select recalc_order_quantities(${orderId}::uuid)`;
  return tx.loadingOrder.findUniqueOrThrow({ where: { id: orderId } });
}
