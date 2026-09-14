import { REALTIME_CHANNEL, type RealtimeMessage } from '@ordens/contracts';
import { systemContext, type Tx } from '@ordens/db';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';
import type { WorkerContext } from '../context.js';
import type { OutboxJob } from '../queues.js';

type Target = Pick<RealtimeMessage, 'keys' | 'orgIds' | 'internalOnly'>;

const orgs = (...ids: (string | null | undefined)[]) => ids.filter((v): v is string => Boolean(v));

/** Decide quais consultas invalidar e quais organizações externas podem ser avisadas. */
export async function realtimeTarget(tx: Tx, type: string, payload: Record<string, unknown>): Promise<Target | null> {
  const id = (key: string) => (typeof payload[key] === 'string' ? (payload[key] as string) : null);
  const orderOrgs = async () => {
    const orderId = id('orderId');
    if (!orderId) return [];
    const o = await tx.loadingOrder.findUnique({ where: { id: orderId }, select: { sellerOrgId: true, buyerOrgId: true, status: true } });
    // Rascunho não é visível às partes externas.
    return o && o.status !== 'DRAFT' ? orgs(o.sellerOrgId, o.buyerOrgId) : [];
  };

  if (type.startsWith('order.')) return { keys: [['orders'], ['dashboard']], orgIds: await orderOrgs() };
  if (type.startsWith('load.') || type.startsWith('appointment.')) return { keys: [['logistics'], ['orders'], ['dashboard']], orgIds: await orderOrgs() };

  if (type.startsWith('invoice.')) {
    const invoiceId = id('invoiceId');
    const inv = invoiceId ? await tx.invoice.findUnique({ where: { id: invoiceId }, select: { sellerOrgId: true, buyerOrgId: true, status: true } }) : null;
    if (!inv) return null;
    const buyerSees = inv.status === 'VALID' || inv.status === 'DIVERGENT';
    return { keys: [['fiscal'], ['logistics'], ['dashboard']], orgIds: orgs(inv.sellerOrgId, buyerSees ? inv.buyerOrgId : null) };
  }

  if (type.startsWith('occurrence.')) {
    const occurrenceId = id('occurrenceId');
    const oc = occurrenceId ? await tx.occurrence.findUnique({ where: { id: occurrenceId }, select: { sellerOrgId: true, buyerOrgId: true, visibility: true } }) : null;
    if (!oc) return null;
    const farm = oc.visibility === 'FARM' || oc.visibility === 'PARTIES';
    const buyer = oc.visibility === 'BUYER' || oc.visibility === 'PARTIES';
    const orgIds = orgs(farm ? oc.sellerOrgId : null, buyer ? oc.buyerOrgId : null);
    return { keys: [['fiscal'], ['dashboard']], orgIds, internalOnly: orgIds.length === 0 };
  }

  if (type === 'upload.available' || type === 'upload.rejected') {
    const uploadId = id('uploadId');
    const fu = uploadId
      ? await tx.fileUpload.findUnique({ where: { id: uploadId }, select: { organizationId: true, sellerOrgId: true, buyerOrgId: true, visibility: true } })
      : null;
    if (!fu) return null;
    const farm = fu.visibility === 'FARM' || fu.visibility === 'PARTIES';
    const buyer = fu.visibility === 'BUYER' || fu.visibility === 'PARTIES';
    return { keys: [['uploads'], ['fiscal']], orgIds: orgs(fu.organizationId, farm ? fu.sellerOrgId : null, buyer ? fu.buyerOrgId : null) };
  }

  return null;
}

/** Publica invalidações no canal Redis consumido pelo stream SSE da API. */
export function realtimeHandler(ctx: WorkerContext, publisher: Redis) {
  return async (job: Job<OutboxJob>) => {
    const { tenantId, type, payload } = job.data;
    if (!tenantId) return;
    const target = await ctx.db.run(systemContext(tenantId), (tx) => realtimeTarget(tx, type, payload));
    if (!target) return;
    const message: RealtimeMessage = { tenantId, kind: 'invalidate', ...target };
    await publisher.publish(REALTIME_CHANNEL, JSON.stringify(message));
  };
}
