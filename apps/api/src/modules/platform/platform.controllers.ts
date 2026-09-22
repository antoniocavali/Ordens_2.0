import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  auditQuerySchema,
  createOrganizationSchema,
  ErrorCode,
  ORG_KIND_LABELS,
  ORG_KIND_PARTNER_ROLES,
  PARTNER_ROLE_LABELS,
  updateOrganizationSchema,
  type CreateOrganizationInput,
  type OrganizationListItem,
  type Scope,
  type UpdateOrganizationInput,
  CRITICAL_2FA_ROLES,
  createUserSchema,
  emailNotificationPrefsSchema,
  resolveEmailPrefs,
  type EmailNotificationPrefs,
  inviteUserSchema,
  membershipGrantsSchema,
  savedViewSchema,
  temporaryPasswordSchema,
  updateMembershipSchema,
  updatePreferencesSchema,
  updateSecurityPolicySchema,
  userListQuery,
  workflowSettingsSchema,
  type WorkflowSettingsDto,
  type WorkflowSettingsInput,
  type AuditEventDto,
  type CreateUserInput,
  type InviteUserInput,
  type Page,
  type SecurityPolicyDto,
  type UserListQuery,
} from '@ordens/contracts';
import { Database, Prisma, writeAudit } from '@ordens/db';
import { z } from 'zod';
import { AllowStages, PlatformOnly, RequirePermission, SelfService } from '../../common/decorators.js';
import { AppError } from '../../common/errors.js';
import { actorMeta, currentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { resolveAuditLabels } from './audit-labels.js';
import { UsersService } from './users.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermission('user.read')
  list(@Query(new ZodPipe(userListQuery)) q: UserListQuery) {
    return this.users.list(q);
  }

  /** Cria o usuário com senha provisória (Q36). */
  @Post()
  @RequirePermission('user.create')
  create(@Body(new ZodPipe(createUserSchema)) body: CreateUserInput) {
    return this.users.create(body);
  }

  @Post('invite')
  @RequirePermission('user.manage')
  invite(@Body(new ZodPipe(inviteUserSchema)) body: InviteUserInput) {
    return this.users.invite(body);
  }

  @Post('memberships/:id/resend-invite')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('user.manage')
  resendInvite(@Param('id', uuid) id: string) {
    return this.users.resendInvite(id);
  }

  /** Concessões individuais (Q34): hoje, definir senha provisória de outros usuários. */
  @Put('memberships/:id/grants')
  @RequirePermission('user.manage')
  setGrants(@Param('id', uuid) id: string, @Body(new ZodPipe(membershipGrantsSchema)) body: z.infer<typeof membershipGrantsSchema>) {
    return this.users.setGrants(id, body.permissions);
  }

  @Post('memberships/:id/password')
  @HttpCode(204)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermission('user.password.manage')
  setTemporaryPassword(@Param('id', uuid) id: string, @Body(new ZodPipe(temporaryPasswordSchema)) body: z.infer<typeof temporaryPasswordSchema>) {
    return this.users.setTemporaryPassword(id, body.temporaryPassword);
  }

  @Patch('memberships/:id')
  @HttpCode(204)
  @RequirePermission('user.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateMembershipSchema)) body: z.infer<typeof updateMembershipSchema>) {
    return this.users.updateMembership(id, body);
  }
}

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly db: TenantDb) {}

  @Get()
  @RequirePermission('organization.read')
  list() {
    return this.db.read((tx) =>
      tx.organization.findMany({ select: { id: true, name: true, kind: true, status: true, partnerId: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }),
    );
  }

  /** Grupos de acesso com o parceiro vinculado e quantos acessos ativos cada um tem. */
  @Get('groups')
  @RequirePermission('organization.manage')
  async groups(): Promise<OrganizationListItem[]> {
    return this.db.read(async (tx) => {
      const orgs = await tx.organization.findMany({
        select: { id: true, name: true, kind: true, status: true, createdAt: true, partner: { select: { id: true, legalName: true, tradeName: true, document: true } } },
        orderBy: [{ kind: 'asc' }, { name: 'asc' }],
      });
      const counts = await tx.membership.groupBy({
        by: ['organizationId'],
        where: { status: 'ACTIVE', user: { status: 'ACTIVE' } },
        _count: { _all: true },
      });
      const byOrg = new Map(counts.map((c) => [c.organizationId, c._count._all]));
      return orgs.map((o) => ({
        id: o.id,
        kind: o.kind,
        name: o.name,
        status: o.status,
        partner: o.partner ? { id: o.partner.id, name: o.partner.tradeName ?? o.partner.legalName, document: o.partner.document } : null,
        usersCount: byOrg.get(o.id) ?? 0,
        scope: o.kind as Scope,
        createdAt: o.createdAt.toISOString(),
      }));
    });
  }

  /**
   * Cria um grupo de acesso para um parceiro. O tipo precisa combinar com os papéis comerciais dele
   * (um Comprador vira grupo BUYER, um Vendedor/Produtor vira FARM), porque é esse vínculo que liga
   * as ordens ao grupo — e, daí, o isolamento por RLS.
   */
  @Post()
  @RequirePermission('organization.manage')
  create(@Body(new ZodPipe(createOrganizationSchema)) body: CreateOrganizationInput) {
    return this.db.write(async (scope) => {
      const partner = await scope.tx.businessPartner.findUnique({
        where: { id: body.partnerId },
        select: { id: true, legalName: true, tradeName: true, status: true, archivedAt: true, roles: { select: { role: true } } },
      });
      if (!partner || partner.archivedAt) throw AppError.notFound('Parceiro não encontrado.');
      if (partner.status !== 'ACTIVE') throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'O parceiro está inativo.');

      const roles = partner.roles.map((r) => r.role);
      if (!ORG_KIND_PARTNER_ROLES[body.kind].some((role) => roles.includes(role))) {
        const aceitos = ORG_KIND_PARTNER_ROLES[body.kind].map((r) => PARTNER_ROLE_LABELS[r]).join(', ');
        throw AppError.domain(ErrorCode.VALIDATION_FAILED, `Para um grupo ${ORG_KIND_LABELS[body.kind]}, o parceiro precisa ter um destes papéis: ${aceitos}.`);
      }
      if (await scope.tx.organization.findFirst({ where: { partnerId: partner.id, kind: body.kind }, select: { id: true } })) {
        throw AppError.conflict(`Este parceiro já tem um grupo ${ORG_KIND_LABELS[body.kind]}.`);
      }

      const name = body.name ?? partner.tradeName ?? partner.legalName;
      const org = await scope.tx.organization.create({ data: { tenantId: currentAuth().membership!.tenantId, kind: body.kind, name, partnerId: partner.id } });
      await scope.audit({ entityType: 'organization', entityId: org.id, action: 'organization.created', after: { kind: org.kind, name: org.name, partnerId: partner.id } });
      return { id: org.id, kind: org.kind, name: org.name, status: org.status };
    });
  }

  /** Renomeia ou ativa/desativa o grupo. Desativar tira o acesso de todo mundo que está nele. */
  @Patch(':id')
  @RequirePermission('organization.manage')
  @HttpCode(204)
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(updateOrganizationSchema)) body: UpdateOrganizationInput) {
    return this.db.write(async (scope) => {
      const before = await scope.tx.organization.findUnique({ where: { id }, select: { id: true, name: true, kind: true, status: true } });
      if (!before) throw AppError.notFound('Grupo não encontrado.');
      if (before.kind === 'MATRIZ') throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'O grupo da Matriz não pode ser alterado por aqui.');

      const after = await scope.tx.organization.update({ where: { id }, data: { name: body.name, status: body.status }, select: { name: true, status: true } });
      await scope.audit({ entityType: 'organization', entityId: id, action: 'organization.updated', before: { name: before.name, status: before.status }, after });
    });
  }
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly db: TenantDb) {}

  @Get('security')
  @RequirePermission('security.policy.manage')
  async getSecurity(): Promise<SecurityPolicyDto> {
    const tenantId = currentAuth().membership!.tenantId;
    const policy = await this.db.read((tx) =>
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { require2fa: true, require2faRoles: true, viewSlaHours: true } }),
    );
    return { ...policy, coverage: await this.coverage(tenantId) };
  }

  @Put('security')
  @RequirePermission('security.policy.manage')
  async updateSecurity(@Body(new ZodPipe(updateSecurityPolicySchema)) body: z.infer<typeof updateSecurityPolicySchema>): Promise<SecurityPolicyDto> {
    const tenantId = currentAuth().membership!.tenantId;
    const after = await this.db.write(async (scope) => {
      const before = await scope.tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { require2fa: true, require2faRoles: true, viewSlaHours: true } });
      const updated = await scope.tx.tenant.update({
        where: { id: tenantId },
        data: { require2fa: body.require2fa, require2faRoles: [...new Set(body.require2faRoles)], viewSlaHours: body.viewSlaHours },
        select: { require2fa: true, require2faRoles: true, viewSlaHours: true },
      });
      await scope.audit({ entityType: 'tenant', entityId: tenantId, action: 'tenant.security_policy_updated', before, after: updated });
      return updated;
    });
    return { ...after, coverage: await this.coverage(tenantId) };
  }

  @Get('workflow')
  @RequirePermission('settings.manage')
  getWorkflow(): Promise<WorkflowSettingsDto> {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.read(async (tx) => {
      const t = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { publishFourEyes: true, publishFourEyesMinT: true } });
      return { publishFourEyes: t.publishFourEyes, publishFourEyesMinT: t.publishFourEyesMinT?.toString() ?? null };
    });
  }

  /** Fluxo de publicação da empresa (Q40), auditado. */
  @Put('workflow')
  @RequirePermission('settings.manage')
  updateWorkflow(@Body(new ZodPipe(workflowSettingsSchema)) body: WorkflowSettingsInput): Promise<WorkflowSettingsDto> {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async (scope) => {
      const before = await scope.tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { publishFourEyes: true, publishFourEyesMinT: true } });
      const after = await scope.tx.tenant.update({
        where: { id: tenantId },
        data: { publishFourEyes: body.publishFourEyes, publishFourEyesMinT: body.publishFourEyes ? body.publishFourEyesMinT : null },
        select: { publishFourEyes: true, publishFourEyesMinT: true },
      });
      const dto = { publishFourEyes: after.publishFourEyes, publishFourEyesMinT: after.publishFourEyesMinT?.toString() ?? null };
      await scope.audit({
        entityType: 'tenant',
        entityId: tenantId,
        action: 'tenant.workflow_updated',
        before: { publishFourEyes: before.publishFourEyes, publishFourEyesMinT: before.publishFourEyesMinT?.toString() ?? null },
        after: dto,
      });
      return dto;
    });
  }

  /**
   * Cobertura de 2FA dos acessos ativos do tenant, sob a RLS de quem consulta. Usa o espelho
   * users.two_factor_enabled: as credenciais em si seguem visíveis só ao próprio usuário.
   */
  private async coverage(tenantId: string): Promise<SecurityPolicyDto['coverage']> {
    const rows = await this.db.read((tx) =>
      tx.$queryRaw<{ membership_id: string; name: string; email: string; organization: string; roles: string[] | null; has_2fa: boolean }[]>(Prisma.sql`
        select m.id as membership_id, u.name, u.email, o.name as organization,
          array_remove(array_agg(mr.role_code::text order by mr.role_code), null) as roles,
          u.two_factor_enabled as has_2fa
        from memberships m
        join users u on u.id = m.user_id
        join organizations o on o.id = m.organization_id
        left join membership_roles mr on mr.membership_id = m.id
        where m.tenant_id = ${tenantId}::uuid and m.status = 'ACTIVE' and u.status = 'ACTIVE'
        group by m.id, u.id, o.name
        order by u.name
      `),
    );
    const byRole = new Map<string, { total: number; with2fa: number }>();
    for (const r of rows) {
      for (const role of r.roles ?? []) {
        const c = byRole.get(role) ?? { total: 0, with2fa: 0 };
        c.total += 1;
        if (r.has_2fa) c.with2fa += 1;
        byRole.set(role, c);
      }
    }
    return {
      totalMembers: rows.length,
      with2fa: rows.filter((r) => r.has_2fa).length,
      roles: [...byRole.entries()].map(([role, c]) => ({ role, ...c })),
      without2fa: rows
        .filter((r) => !r.has_2fa)
        .slice(0, 500)
        .map((r) => ({ membershipId: r.membership_id, name: r.name, email: r.email, organization: r.organization, roles: r.roles ?? [] })),
    };
  }
}

@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly db: TenantDb) {}

  @Get()
  @RequirePermission('audit.read')
  list(@Query(new ZodPipe(auditQuerySchema)) q: z.infer<typeof auditQuerySchema>): Promise<Page<AuditEventDto>> {
    return this.db.read(async (tx) => {
      const where = {
        tenantId: currentAuth().membership!.tenantId,
        ...(q.entityType ? { entityType: q.entityType } : {}),
        ...(q.entityId ? { entityId: q.entityId } : {}),
        ...(q.action ? { action: { startsWith: q.action } } : {}),
        ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
        ...(q.from || q.to ? { occurredAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.auditEvent.count({ where }),
        tx.auditEvent.findMany({ where, orderBy: { occurredAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      const ids = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)))];
      const users = ids.length ? await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
      const names = new Map(users.map((u) => [u.id, u.name]));
      const labels = await resolveAuditLabels(tx, rows);
      return {
        total,
        page: q.page,
        pageSize: q.pageSize,
        items: rows.map((r) => ({
          id: r.id.toString(),
          occurredAt: r.occurredAt.toISOString(),
          actor: r.actorUserId ? { id: r.actorUserId, name: names.get(r.actorUserId) ?? 'Usuário' } : null,
          actorRole: r.actorRole,
          entityType: r.entityType,
          entityId: r.entityId,
          entityLabel: r.entityId ? (labels.get(`${r.entityType}:${r.entityId}`) ?? null) : null,
          action: r.action,
          before: r.before,
          after: r.after,
          ip: r.ip,
          requestId: r.requestId,
          correlationId: r.correlationId,
        })),
      };
    });
  }
}

@ApiTags('me')
@SelfService()
@Controller('me')
export class MeController {
  constructor(private readonly db: TenantDb) {}

  @Patch('preferences')
  @AllowStages('ACTIVE', 'PENDING_2FA_SETUP')
  @HttpCode(204)
  async preferences(@Body(new ZodPipe(updatePreferencesSchema)) body: z.infer<typeof updatePreferencesSchema>) {
    const { userId } = currentAuth();
    await this.db.self((scope) =>
      scope.tx.userPreference.upsert({
        where: { userId },
        create: { userId, ...body },
        update: body,
      }),
    );
  }

  /** Q44: e-mails dos avisos, por tipo (o aviso no sistema continua sempre ativo). */
  @Get('notification-preferences')
  async notificationPreferences() {
    const { userId } = currentAuth();
    const pref = await this.db.self(({ tx }) => tx.userPreference.findUnique({ where: { userId }, select: { data: true } }));
    return resolveEmailPrefs((pref?.data as Record<string, unknown> | null)?.emailNotifications);
  }

  @Put('notification-preferences')
  async updateNotificationPreferences(@Body(new ZodPipe(emailNotificationPrefsSchema)) body: EmailNotificationPrefs) {
    const { userId } = currentAuth();
    return this.db.self(async ({ tx, audit }) => {
      const current = await tx.userPreference.findUnique({ where: { userId }, select: { data: true } });
      const data = (current?.data as Record<string, unknown> | null) ?? {};
      const before = resolveEmailPrefs(data.emailNotifications);
      const next = resolveEmailPrefs(body);
      await tx.userPreference.upsert({
        where: { userId },
        create: { userId, data: { emailNotifications: next } },
        update: { data: { ...data, emailNotifications: next } },
      });
      await audit({ entityType: 'user', entityId: userId, action: 'user.notification_preferences_updated', before, after: next });
      return next;
    });
  }

  @Get('saved-views')
  @RequirePermission('order.read')
  savedViews(@Query('resource') resource = 'orders') {
    const { userId } = currentAuth();
    return this.db.read((tx) => tx.savedView.findMany({ where: { userId, resource }, orderBy: { createdAt: 'asc' } }));
  }

  @Post('saved-views')
  @RequirePermission('order.read')
  createView(@Body(new ZodPipe(savedViewSchema)) body: z.infer<typeof savedViewSchema>) {
    const auth = currentAuth();
    return this.db.write(async (scope) => {
      if (body.isDefault) {
        await scope.tx.savedView.updateMany({ where: { userId: auth.userId, resource: body.resource }, data: { isDefault: false } });
      }
      return scope.tx.savedView.create({
        data: { tenantId: auth.membership!.tenantId, userId: auth.userId, resource: body.resource, name: body.name, state: body.state as object, isDefault: body.isDefault },
      });
    });
  }

  @Delete('saved-views/:id')
  @HttpCode(204)
  @RequirePermission('order.read')
  async deleteView(@Param('id', uuid) id: string) {
    const deleted = await this.db.write((scope) => scope.tx.savedView.deleteMany({ where: { id, userId: currentAuth().userId } }));
    if (!deleted.count) throw AppError.notFound('Visualização não encontrada.');
  }
}

const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{3,40}$/),
  matrizName: z.string().trim().min(2).max(120),
});

/** Superadministrador SaaS: gestão de tenants (sem acesso a dados de negócio). */
@ApiTags('platform')
@Controller('platform/tenants')
@PlatformOnly()
export class TenantsController {
  constructor(private readonly db: Database) {}

  @Get()
  list() {
    const auth = currentAuth();
    return this.db.run({ tenantId: null, userId: auth.userId, membershipId: null, scope: 'PLATFORM', orgIds: [] }, (tx) =>
      tx.tenant.findMany({ select: { id: true, slug: true, name: true, status: true, createdAt: true }, orderBy: { name: 'asc' } }),
    );
  }

  @Post()
  create(@Body(new ZodPipe(createTenantSchema)) body: z.infer<typeof createTenantSchema>) {
    const auth = currentAuth();
    const tenantId = randomUUID();
    return this.db.run({ tenantId, userId: auth.userId, membershipId: null, scope: 'PLATFORM', orgIds: [] }, async (tx) => {
      // 2FA obrigatória para quem publica ordens ou gerencia usuários (aprovada em 18/09/2026).
      const tenant = await tx.tenant.create({ data: { id: tenantId, name: body.name, slug: body.slug, require2faRoles: [...CRITICAL_2FA_ROLES] } });
      await tx.organization.create({ data: { tenantId, kind: 'MATRIZ', name: body.matrizName } });
      await tx.unit.createMany({
        data: [
          { tenantId, code: 'KG', name: 'Quilograma', factorToKg: '1' },
          { tenantId, code: 'T', name: 'Tonelada', factorToKg: '1000' },
          { tenantId, code: 'SC60', name: 'Saca 60 kg', factorToKg: '60' },
        ],
      });
      await writeAudit(tx, { tenantId, userId: auth.userId, membershipId: null, scope: 'PLATFORM', orgIds: [] }, actorMeta(), {
        entityType: 'tenant',
        entityId: tenantId,
        action: 'tenant.created',
        after: body,
      });
      return tenant;
    });
  }
}
