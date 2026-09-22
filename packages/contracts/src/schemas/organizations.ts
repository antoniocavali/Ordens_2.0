import { z } from 'zod';
import { type OrgKind, type PartnerRole, type RecordStatus, type Scope } from '../enums.js';

/**
 * Organizações são os grupos de acesso do tenant: cada usuário de fora da Matriz pertence a um grupo,
 * e o isolamento do banco (RLS) garante que ele só enxergue os dados desse grupo. Toda organização de
 * fora da Matriz nasce vinculada a um parceiro — é esse vínculo que liga as ordens ao grupo certo
 * (os gatilhos `loading_orders_derive`/`contracts_derive` derivam vendedor e comprador do parceiro).
 */
export const MANAGEABLE_ORG_KINDS = ['FARM', 'BUYER', 'CARRIER'] as const satisfies readonly OrgKind[];
export type ManageableOrgKind = (typeof MANAGEABLE_ORG_KINDS)[number];

export const ORG_KIND_LABELS: Record<OrgKind, string> = {
  MATRIZ: 'Matriz',
  FARM: 'Fazenda / Vendedor',
  BUYER: 'Comprador',
  CARRIER: 'Transportadora',
};

export const ORG_KIND_DESCRIPTIONS: Record<ManageableOrgKind, string> = {
  FARM: 'Registra o carregamento na origem: pesagem, NF-e da fazenda, agendamentos e ocorrências.',
  BUYER: 'Solicita ordens e acompanha as cargas destinadas a ele; consulta documentos e ocorrências.',
  CARRIER: 'Acompanha agendamentos, cargas e documentos do transporte.',
};

/** Papéis de parceiro que autorizam cada tipo de organização (Q35: o grupo herda o papel comercial). */
export const ORG_KIND_PARTNER_ROLES: Record<ManageableOrgKind, readonly PartnerRole[]> = {
  FARM: ['SELLER', 'PRODUCER', 'COOPERATIVE_MEMBER', 'COOPERATIVE'],
  BUYER: ['BUYER'],
  CARRIER: ['CARRIER'],
};

/** Tipos de organização que um parceiro pode ter, conforme os papéis comerciais dele. */
export function orgKindsForPartnerRoles(roles: readonly PartnerRole[]): ManageableOrgKind[] {
  return MANAGEABLE_ORG_KINDS.filter((kind) => ORG_KIND_PARTNER_ROLES[kind].some((role) => roles.includes(role)));
}

export const createOrganizationSchema = z.object({
  kind: z.enum(MANAGEABLE_ORG_KINDS),
  partnerId: z.uuid('Selecione o parceiro'),
  /** Vazio usa o nome do parceiro. */
  name: z.string().trim().min(2, 'Informe um nome com ao menos 2 caracteres').max(160).optional(),
});
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2, 'Informe um nome com ao menos 2 caracteres').max(160).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, { message: 'Nada para alterar' });
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;

export interface OrganizationListItem {
  id: string;
  kind: OrgKind;
  name: string;
  status: RecordStatus;
  partner: { id: string; name: string; document: string } | null;
  /** Acessos ativos no grupo. */
  usersCount: number;
  /** Escopo das memberships desse grupo (igual ao tipo; ajuda a explicar as permissões na tela). */
  scope: Scope;
  createdAt: string;
}
