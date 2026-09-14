import { randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  auditQuerySchema,
  inviteUserSchema,
  membershipGrantsSchema,
  savedViewSchema,
  temporaryPasswordSchema,
  updateMembershipSchema,
  updatePreferencesSchema,
  updateSecurityPolicySchema,
  userListQuery,
  type AuditEventDto,
  type InviteUserInput,
  type Page,
  type UserListQuery,
} from '@ordens/contracts';
import { Database, writeAudit } from '@ordens/db';
import { z } from 'zod';
import { AllowStages, PlatformOnly, RequirePermission } from '../../common/decorators.js';
import { AppError } from '../../common/errors.js';
import { actorMeta, currentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
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
}

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly db: TenantDb) {}

  @Get('security')
  @RequirePermission('security.policy.manage')
  getSecurity() {
    return this.db.read((tx) =>
      tx.tenant.findUniqueOrThrow({
        where: { id: currentAuth().membership!.tenantId },
        select: { require2fa: true, require2faRoles: true, viewSlaHours: true },
      }),
    );
  }

  @Put('security')
  @RequirePermission('security.policy.manage')
  updateSecurity(@Body(new ZodPipe(updateSecurityPolicySchema)) body: z.infer<typeof updateSecurityPolicySchema>) {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async (scope) => {
      const before = await scope.tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { require2fa: true, require2faRoles: true, viewSlaHours: true } });
      const after = await scope.tx.tenant.update({
        where: { id: tenantId },
        data: { require2fa: body.require2fa, require2faRoles: body.require2faRoles, viewSlaHours: body.viewSlaHours },
        select: { require2fa: true, require2faRoles: true, viewSlaHours: true },
      });
      await scope.audit({ entityType: 'tenant', entityId: tenantId, action: 'tenant.security_policy_updated', before, after });
      return after;
    });
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
      const tenant = await tx.tenant.create({ data: { id: tenantId, name: body.name, slug: body.slug } });
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
