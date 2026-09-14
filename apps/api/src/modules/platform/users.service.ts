import { Inject, Injectable } from '@nestjs/common';
import { ErrorCode, ROLES, type InviteUserInput, type Page, type RoleDefinition, type UserListItem } from '@ordens/contracts';
import { Database, Prisma, writeOutbox } from '@ordens/db';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { actorMeta, currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { encrypt, randomToken, sha256, toBase64, type Bytes } from '../auth/crypto.js';
import { SessionService } from '../auth/session.service.js';

@Injectable()
export class UsersService {
  private readonly outboxKey: Bytes;

  constructor(
    private readonly tenantDb: TenantDb,
    private readonly db: Database,
    private readonly sessions: SessionService,
    @Inject(ENV) env: Env,
  ) {
    this.outboxKey = sha256(`outbox:${env.SESSION_SECRET}`);
  }

  async list(params: { page: number; pageSize: number; q?: string }): Promise<Page<UserListItem>> {
    return this.tenantDb.read(async (tx) => {
      const where: Prisma.MembershipWhereInput = params.q
        ? { user: { OR: [{ name: { contains: params.q, mode: 'insensitive' } }, { email: { contains: params.q, mode: 'insensitive' } }] } }
        : {};
      const [total, rows] = await Promise.all([
        tx.membership.count({ where }),
        tx.membership.findMany({
          where,
          include: {
            user: { select: { id: true, name: true, email: true, twoFactorEnabled: true, lastLoginAt: true } },
            organization: { select: { id: true, name: true, kind: true } },
            roles: { select: { roleCode: true } },
          },
          orderBy: [{ organization: { name: 'asc' } }, { user: { name: 'asc' } }],
          skip: (params.page - 1) * params.pageSize,
          take: params.pageSize,
        }),
      ]);
      return {
        total,
        page: params.page,
        pageSize: params.pageSize,
        items: rows.map((m) => ({
          membershipId: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          organization: m.organization,
          roles: m.roles.map((r) => r.roleCode),
          status: m.status,
          twoFactorEnabled: m.user.twoFactorEnabled,
          lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
        })),
      };
    });
  }

  async invite(input: InviteUserInput): Promise<{ membershipId: string; userId: string; invited: boolean }> {
    const auth = currentAuth();
    const tenantId = auth.membership!.tenantId;

    // Existência de e-mail é global (usuário pode pertencer a outro tenant): consulta mínima em contexto SYSTEM.
    const existingUser = await this.db.system((tx) => tx.user.findUnique({ where: { email: input.email }, select: { id: true, passwordHash: true } }));

    const result = await this.tenantDb.write(async (scope) => {
      const { tx } = scope;
      const org = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!org) throw AppError.notFound('Organização não encontrada.');
      const invalidRole = input.roles.find((r) => (ROLES as Record<string, RoleDefinition>)[r]?.scope !== org.kind);
      if (invalidRole) {
        throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Perfil incompatível com o tipo da organização.', { fields: { roles: [invalidRole] } });
      }

      const userId =
        existingUser?.id ??
        (await tx.user.create({ data: { email: input.email, name: input.name }, select: { id: true } })).id;

      const dup = await tx.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: org.id } } });
      if (dup) throw AppError.conflict('Este usuário já participa desta organização.');

      const membership = await tx.membership.create({ data: { tenantId, userId, organizationId: org.id, scope: org.kind } });
      await tx.membershipRole.createMany({ data: input.roles.map((roleCode) => ({ membershipId: membership.id, roleCode, tenantId })) });
      await scope.audit({
        entityType: 'membership',
        entityId: membership.id,
        action: 'user.invited',
        after: { email: input.email, organizationId: org.id, roles: input.roles, newUser: !existingUser },
      });
      return { membershipId: membership.id, userId, organizationName: org.name };
    });

    // Usuário novo sem senha: token de definição de senha (72h) enviado pelo worker.
    const needsPassword = !existingUser?.passwordHash;
    if (needsPassword) {
      const token = randomToken(32);
      await this.db.system(async (tx) => {
        await tx.passwordResetToken.create({
          data: { userId: result.userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3_600_000) },
        });
        await writeOutbox(tx, { tenantId, userId: auth.userId, membershipId: null, scope: 'SYSTEM', orgIds: [] }, actorMeta(), {
          type: 'user.invited',
          aggregateType: 'user',
          aggregateId: result.userId,
          payload: { email: input.email, name: input.name, organization: result.organizationName, tokenEnc: toBase64(encrypt(this.outboxKey, token)) },
        });
      }, tenantId);
    }
    return { membershipId: result.membershipId, userId: result.userId, invited: needsPassword };
  }

  async updateMembership(id: string, input: { roles?: string[]; status?: 'ACTIVE' | 'INACTIVE' }) {
    const auth = currentAuth();
    const updated = await this.tenantDb.write(async (scope) => {
      const { tx } = scope;
      const m = await tx.membership.findUnique({ where: { id }, include: { roles: true } });
      if (!m) throw AppError.notFound('Usuário não encontrado.');
      if (m.userId === auth.userId && input.status === 'INACTIVE') {
        throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Você não pode desativar o próprio acesso.');
      }
      const before = { roles: m.roles.map((r) => r.roleCode), status: m.status };
      if (input.roles) {
        const invalid = input.roles.find((r) => (ROLES as Record<string, RoleDefinition>)[r]?.scope !== m.scope);
        if (invalid) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Perfil incompatível com a organização.', { fields: { roles: [invalid] } });
        await tx.membershipRole.deleteMany({ where: { membershipId: id } });
        await tx.membershipRole.createMany({ data: input.roles.map((roleCode) => ({ membershipId: id, roleCode, tenantId: m.tenantId })) });
      }
      if (input.status) await tx.membership.update({ where: { id }, data: { status: input.status } });
      await scope.audit({ entityType: 'membership', entityId: id, action: 'user.membership_updated', before, after: input });
      return m;
    });
    await this.sessions.signalAuthzChange(updated.userId);
  }
}
