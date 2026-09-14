import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  effectivePermissions,
  ErrorCode,
  GRANTABLE_PERMISSIONS,
  ROLES,
  type CreateUserInput,
  type GrantablePermission,
  type InviteUserInput,
  type InviteUserResult,
  type Page,
  type RoleDefinition,
  type UpdateMembershipInput,
  type UserListItem,
  type UserListQuery,
} from '@ordens/contracts';
import { Database, hashPassword, Prisma, systemContext, writeAudit, writeOutbox, type Tx } from '@ordens/db';
import { ENV, type Env } from '../../config/env.js';
import { AppError } from '../../common/errors.js';
import { actorMeta, currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { encrypt, randomToken, sha256, toBase64, type Bytes } from '../auth/crypto.js';
import { SessionService } from '../auth/session.service.js';

const INVITE_TTL_MS = 72 * 3_600_000;
/** Papel de administração que não pode ficar sem ninguém ativo (Q33). */
const ADMIN_ROLE: Partial<Record<string, string>> = { MATRIZ: 'MATRIZ_ADMIN', FARM: 'FARM_ADMIN' };

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

  async list(params: UserListQuery): Promise<Page<UserListItem>> {
    return this.tenantDb.read(async (tx) => {
      // RLS limita o que cada escopo enxerga (Fazenda/Comprador: só a própria organização).
      const where: Prisma.MembershipWhereInput = {
        AND: [
          params.q ? { user: { OR: [{ name: { contains: params.q, mode: 'insensitive' } }, { email: { contains: params.q, mode: 'insensitive' } }] } } : {},
          params.status ? { status: params.status } : {},
          params.organizationId ? { organizationId: params.organizationId } : {},
          params.role ? { roles: { some: { roleCode: params.role } } } : {},
        ],
      };
      const [total, rows] = await Promise.all([
        tx.membership.count({ where }),
        tx.membership.findMany({
          where,
          include: {
            user: { select: { id: true, name: true, email: true, twoFactorEnabled: true, lastLoginAt: true, passwordHash: true, mustChangePassword: true } },
            organization: { select: { id: true, name: true, kind: true } },
            roles: { select: { roleCode: true } },
            customRoles: { select: { role: { select: { id: true, name: true, status: true } } } },
            permissionGrants: { select: { permissionCode: true } },
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
          id: m.id,
          membershipId: m.id,
          userId: m.user.id,
          name: m.user.name,
          email: m.user.email,
          organization: m.organization,
          scope: m.scope,
          roles: m.roles.map((r) => r.roleCode),
          customRoles: m.customRoles.map((c) => ({ id: c.role.id, name: c.role.name, status: c.role.status })),
          grants: m.permissionGrants.map((g) => g.permissionCode),
          status: m.status,
          twoFactorEnabled: m.user.twoFactorEnabled,
          lastLoginAt: m.user.lastLoginAt?.toISOString() ?? null,
          invitePending: !m.user.passwordHash,
          mustChangePassword: m.user.mustChangePassword,
        })),
      };
    });
  }

  async invite(input: InviteUserInput): Promise<InviteUserResult> {
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
      await this.assertCustomRoles(tx, input.customRoleIds, org.kind);

      // Usuário novo: insert sem RETURNING. Pela RLS de users, quem convida só enxerga o usuário depois que a
      // membership existe; o id é gerado aqui para manter tudo na mesma transação.
      let userId = existingUser?.id;
      if (!userId) {
        userId = randomUUID();
        await tx.$executeRaw`insert into users (id, email, name, updated_at) values (${userId}::uuid, ${input.email}, ${input.name}, now())`;
      }

      const dup = await tx.membership.findUnique({ where: { userId_organizationId: { userId, organizationId: org.id } } });
      if (dup) throw AppError.conflict('Este usuário já participa desta organização.');

      const membership = await tx.membership.create({ data: { tenantId, userId, organizationId: org.id, scope: org.kind } });
      await tx.membershipRole.createMany({ data: input.roles.map((roleCode) => ({ membershipId: membership.id, roleCode, tenantId })) });
      await tx.membershipCustomRole.createMany({ data: input.customRoleIds.map((roleId) => ({ membershipId: membership.id, roleId, tenantId })) });
      await scope.audit({
        entityType: 'membership',
        entityId: membership.id,
        action: 'user.invited',
        after: { email: input.email, organizationId: org.id, roles: input.roles, customRoleIds: input.customRoleIds, newUser: !existingUser },
      });
      return { membershipId: membership.id, userId, organizationName: org.name };
    });

    // Usuário sem senha: token de definição de senha (72h) enviado pelo worker.
    const needsPassword = !existingUser?.passwordHash;
    if (needsPassword) {
      await this.sendInviteEmail({ userId: result.userId, email: input.email, name: input.name, organization: result.organizationName, tenantId, invalidatePrevious: false });
    }
    return { membershipId: result.membershipId, userId: result.userId, invited: needsPassword };
  }

  /**
   * Criação direta com senha provisória (Q36): sem e-mail de convite; troca obrigatória no primeiro acesso.
   * Quem cria só atribui papéis cujas permissões já possui (sem escalar privilégios).
   */
  async create(input: CreateUserInput): Promise<InviteUserResult> {
    const auth = currentAuth();
    const tenantId = auth.membership!.tenantId;
    const existing = await this.db.system((tx) => tx.user.findUnique({ where: { email: input.email }, select: { id: true } }));
    if (existing) {
      throw AppError.validation({ fields: { email: ['Já existe uma conta com este e-mail. Use "Convidar usuário" para dar acesso a ela.'] } });
    }
    const passwordHash = await hashPassword(input.temporaryPassword);

    const result = await this.tenantDb.write(async (scope) => {
      const { tx } = scope;
      const org = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!org) throw AppError.notFound('Organização não encontrada.');
      const invalidRole = input.roles.find((r) => (ROLES as Record<string, RoleDefinition>)[r]?.scope !== org.kind);
      if (invalidRole) {
        throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Perfil incompatível com o tipo da organização.', { fields: { roles: [invalidRole] } });
      }
      await this.assertCustomRoles(tx, input.customRoleIds, org.kind);

      const customPerms = input.customRoleIds.length
        ? await tx.tenantRolePermission.findMany({ where: { roleId: { in: input.customRoleIds } }, select: { permissionCode: true } })
        : [];
      const granted = effectivePermissions(input.roles, customPerms.map((p) => p.permissionCode));
      const beyond = [...granted].filter((p) => !auth.permissions.has(p));
      if (beyond.length) {
        throw AppError.forbidden('Você não pode atribuir papéis com permissões que você não tem.');
      }

      const userId = randomUUID();
      await tx.$executeRaw`insert into users (id, email, name, updated_at) values (${userId}::uuid, ${input.email}, ${input.name}, now())`;
      const membership = await tx.membership.create({ data: { tenantId, userId, organizationId: org.id, scope: org.kind } });
      await tx.membershipRole.createMany({ data: input.roles.map((roleCode) => ({ membershipId: membership.id, roleCode, tenantId })) });
      await tx.membershipCustomRole.createMany({ data: input.customRoleIds.map((roleId) => ({ membershipId: membership.id, roleId, tenantId })) });
      await scope.audit({
        entityType: 'membership',
        entityId: membership.id,
        action: 'user.created',
        after: { email: input.email, organizationId: org.id, roles: input.roles, customRoleIds: input.customRoleIds, mustChangePassword: true },
      });
      return { membershipId: membership.id, userId };
    });

    // Senha é dado global do usuário: gravada em contexto de sistema, fora da RLS do tenant.
    await this.db.run(systemContext(tenantId), (tx) => tx.user.update({ where: { id: result.userId }, data: { passwordHash, mustChangePassword: true } }));
    return { ...result, invited: false };
  }

  /** Novo link de convite para quem ainda não definiu a senha; o link anterior deixa de valer. */
  async resendInvite(membershipId: string): Promise<void> {
    const tenantId = currentAuth().membership!.tenantId;
    const row = await this.tenantDb.write(async (scope) => {
      const m = await scope.tx.membership.findUnique({
        where: { id: membershipId },
        include: { user: { select: { id: true, name: true, email: true, passwordHash: true } }, organization: { select: { name: true } } },
      });
      if (!m) throw AppError.notFound('Usuário não encontrado.');
      if (m.user.passwordHash) throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Este usuário já definiu a senha: não há convite pendente.');
      if (m.status !== 'ACTIVE') throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Reative o acesso antes de reenviar o convite.');
      await scope.audit({ entityType: 'membership', entityId: m.id, action: 'user.invite_resent', after: { email: m.user.email } });
      return m;
    });
    await this.sendInviteEmail({ userId: row.user.id, email: row.user.email, name: row.user.name, organization: row.organization.name, tenantId, invalidatePrevious: true });
  }

  async updateMembership(id: string, input: UpdateMembershipInput) {
    const auth = currentAuth();
    const updated = await this.tenantDb.write(async (scope) => {
      const { tx } = scope;
      const m = await tx.membership.findUnique({ where: { id }, include: { roles: true, customRoles: { select: { roleId: true } } } });
      if (!m) throw AppError.notFound('Usuário não encontrado.');
      if (m.userId === auth.userId && input.status === 'INACTIVE') {
        throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Você não pode desativar o próprio acesso.');
      }
      const before = { roles: m.roles.map((r) => r.roleCode), customRoleIds: m.customRoles.map((c) => c.roleId), status: m.status };
      const nextRoles = input.roles ?? before.roles;
      const nextCustom = input.customRoleIds ?? before.customRoleIds;
      const nextStatus = input.status ?? m.status;
      if ((input.roles || input.customRoleIds) && nextRoles.length + nextCustom.length === 0) {
        throw AppError.validation({ fields: { roles: ['Selecione ao menos um papel'] } });
      }

      // Matriz e cada Fazenda mantêm ao menos um administrador ativo (Q33).
      const adminRole = ADMIN_ROLE[m.scope];
      const wasAdmin = Boolean(adminRole && before.roles.includes(adminRole) && m.status === 'ACTIVE');
      const staysAdmin = Boolean(adminRole && nextRoles.includes(adminRole) && nextStatus === 'ACTIVE');
      if (adminRole && wasAdmin && !staysAdmin) {
        const others = await tx.membership.count({
          where: {
            id: { not: id },
            status: 'ACTIVE',
            roles: { some: { roleCode: adminRole } },
            ...(m.scope === 'MATRIZ' ? { scope: 'MATRIZ' } : { organizationId: m.organizationId }),
          },
        });
        if (!others) {
          throw AppError.domain(
            ErrorCode.VALIDATION_FAILED,
            m.scope === 'MATRIZ' ? 'A Matriz precisa de ao menos um Administrador ativo. Promova outra pessoa antes.' : 'A organização precisa de ao menos um Administrador ativo. Promova outra pessoa antes.',
            { fields: { roles: [adminRole] } },
          );
        }
      }

      if (input.roles) {
        const invalid = input.roles.find((r) => (ROLES as Record<string, RoleDefinition>)[r]?.scope !== m.scope);
        if (invalid) throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Perfil incompatível com a organização.', { fields: { roles: [invalid] } });
        await tx.membershipRole.deleteMany({ where: { membershipId: id } });
        await tx.membershipRole.createMany({ data: input.roles.map((roleCode) => ({ membershipId: id, roleCode, tenantId: m.tenantId })) });
      }
      if (input.customRoleIds) {
        const added = input.customRoleIds.filter((r) => !before.customRoleIds.includes(r));
        await this.assertCustomRoles(tx, added, m.scope);
        await tx.membershipCustomRole.deleteMany({ where: { membershipId: id, roleId: { notIn: input.customRoleIds } } });
        await tx.membershipCustomRole.createMany({ data: added.map((roleId) => ({ membershipId: id, roleId, tenantId: m.tenantId })) });
      }
      if (input.roles || input.customRoleIds) {
        // Sem permissão de atender: sai das filas do atendimento (Q31).
        const customPerms = await tx.tenantRolePermission.findMany({
          where: { roleId: { in: nextCustom }, role: { status: 'ACTIVE' } },
          select: { permissionCode: true },
        });
        const perms = effectivePermissions(nextRoles, customPerms.map((p) => p.permissionCode));
        if (m.scope === 'MATRIZ' && !perms.has('support.attend') && !perms.has('support.manage')) {
          await tx.supportQueueMember.deleteMany({ where: { membershipId: id } });
        }
      }
      if (input.status) await tx.membership.update({ where: { id }, data: { status: input.status } });
      await scope.audit({ entityType: 'membership', entityId: id, action: 'user.membership_updated', before, after: input });
      return m;
    });
    await this.sessions.signalAuthzChange(updated.userId);
  }

  /** Concessões individuais de um acesso da Matriz (Q34). */
  async setGrants(membershipId: string, permissions: GrantablePermission[]): Promise<{ grants: string[] }> {
    const auth = currentAuth();
    if (auth.membership?.scope !== 'MATRIZ') throw AppError.forbidden('Somente a Matriz concede permissões individuais.');
    const wanted = GRANTABLE_PERMISSIONS.filter((p) => permissions.includes(p));
    const result = await this.tenantDb.write(async (scope) => {
      const { tx } = scope;
      const m = await tx.membership.findUnique({ where: { id: membershipId }, include: { permissionGrants: { select: { permissionCode: true } } } });
      if (!m) throw AppError.notFound('Usuário não encontrado.');
      if (m.scope !== 'MATRIZ') throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Permissões individuais valem apenas para acessos da Matriz.');
      const current = m.permissionGrants.map((g) => g.permissionCode);
      const removed = current.filter((p) => !(wanted as string[]).includes(p));
      const added = wanted.filter((p) => !current.includes(p));
      if (removed.length) await tx.membershipPermissionGrant.deleteMany({ where: { membershipId, permissionCode: { in: removed } } });
      if (added.length) {
        await tx.membershipPermissionGrant.createMany({ data: added.map((permissionCode) => ({ membershipId, permissionCode, tenantId: m.tenantId, grantedBy: auth.userId })) });
      }
      if (removed.length || added.length) {
        await scope.audit({ entityType: 'membership', entityId: membershipId, action: 'user.permissions_granted', before: { grants: current }, after: { grants: wanted } });
      }
      return { userId: m.userId, grants: [...wanted] };
    });
    await this.sessions.signalAuthzChange(result.userId);
    return { grants: result.grants };
  }

  /**
   * Senha provisória: derruba as sessões da pessoa e exige nova senha no próximo acesso (Q34).
   * A senha é global na plataforma, por isso só vale para quem acessa apenas este tenant.
   */
  async setTemporaryPassword(membershipId: string, temporaryPassword: string): Promise<void> {
    const auth = currentAuth();
    const tenantId = auth.membership!.tenantId;
    const target = await this.tenantDb.read((tx) =>
      tx.membership.findUnique({
        where: { id: membershipId },
        include: { roles: { select: { roleCode: true } }, user: { select: { id: true, email: true, status: true, isPlatformAdmin: true } } },
      }),
    );
    if (!target) throw AppError.notFound('Usuário não encontrado.');
    if (target.userId === auth.userId) {
      throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Para alterar a sua própria senha, use Minha conta → Segurança.');
    }
    if (target.user.isPlatformAdmin) throw AppError.forbidden('Não é possível redefinir a senha deste usuário.');
    const targetIsAdmin = target.roles.some((r) => r.roleCode === 'MATRIZ_ADMIN');
    const actorIsAdmin = auth.membership?.roles.includes('MATRIZ_ADMIN') ?? false;
    if (targetIsAdmin && !actorIsAdmin) {
      throw AppError.forbidden('Somente um Administrador Matriz pode redefinir a senha de outro administrador.');
    }
    const otherTenants = await this.db.system((tx) => tx.membership.count({ where: { userId: target.userId, tenantId: { not: tenantId } } }));
    if (otherTenants) {
      throw AppError.domain(
        ErrorCode.VALIDATION_FAILED,
        'Esta pessoa também acessa outra empresa na plataforma. Peça que ela use "Esqueci minha senha" na tela de login.',
      );
    }

    const passwordHash = await hashPassword(temporaryPassword);
    await this.db.run(systemContext(tenantId), async (tx) => {
      await tx.user.update({ where: { id: target.userId }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } });
      // Links de convite ou de redefinição pendentes deixam de valer.
      await tx.passwordResetToken.updateMany({ where: { userId: target.userId, usedAt: null }, data: { usedAt: new Date() } });
      await this.sessions.bumpSecurityVersion(tx, target.userId, 'temporary_password_set');
      await writeAudit(tx, systemContext(tenantId), actorMeta(), {
        entityType: 'membership',
        entityId: membershipId,
        action: 'user.temporary_password_set',
        after: { userId: target.userId, email: target.user.email, mustChangePassword: true },
      });
    });
  }

  /** Papéis personalizados existentes, ativos e do mesmo escopo da organização. */
  private async assertCustomRoles(tx: Tx, ids: readonly string[], scope: string) {
    if (!ids.length) return;
    const roles = await tx.tenantRole.findMany({ where: { id: { in: [...ids] } }, select: { id: true, scope: true, status: true } });
    const invalid = ids.find((id) => {
      const r = roles.find((x) => x.id === id);
      return !r || r.status !== 'ACTIVE' || r.scope !== scope;
    });
    if (invalid) {
      throw AppError.domain(ErrorCode.INCONSISTENT_RELATION, 'Papel personalizado inexistente, arquivado ou incompatível com a organização.', { fields: { roles: [invalid] } });
    }
  }

  private async sendInviteEmail(p: { userId: string; email: string; name: string; organization: string; tenantId: string; invalidatePrevious: boolean }) {
    const auth = currentAuth();
    const token = randomToken(32);
    await this.db.system(async (tx) => {
      if (p.invalidatePrevious) {
        await tx.passwordResetToken.updateMany({ where: { userId: p.userId, usedAt: null }, data: { usedAt: new Date() } });
      }
      await tx.passwordResetToken.create({ data: { userId: p.userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS) } });
      await writeOutbox(tx, { tenantId: p.tenantId, userId: auth.userId, membershipId: null, scope: 'SYSTEM', orgIds: [] }, actorMeta(), {
        type: 'user.invited',
        aggregateType: 'user',
        aggregateId: p.userId,
        payload: { email: p.email, name: p.name, organization: p.organization, tokenEnc: toBase64(encrypt(this.outboxKey, token)) },
      });
    }, p.tenantId);
  }
}
