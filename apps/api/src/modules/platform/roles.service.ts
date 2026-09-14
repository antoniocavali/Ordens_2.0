import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  PERMISSIONS,
  permissionsAllowedForScope,
  ROLE_CODES,
  ROLES,
  type CustomRoleInput,
  type Permission,
  type RoleDto,
} from '@ordens/contracts';
import { Prisma, type Tx } from '@ordens/db';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { SessionService } from '../auth/session.service.js';

type CustomRoleRow = Prisma.TenantRoleGetPayload<{ include: { permissions: { select: { permissionCode: true } }; _count: { select: { memberships: true } } } }>;

const toDto = (r: CustomRoleRow): RoleDto => ({
  id: r.id,
  name: r.name,
  description: r.description,
  scope: r.scope,
  system: false,
  status: r.status,
  permissions: r.permissions.map((p) => p.permissionCode as Permission),
  membersCount: r._count.memberships,
  updatedAt: r.updatedAt.toISOString(),
});

/** Papéis: os do sistema são fixos (consulta); os personalizados são do tenant e editáveis pela Matriz (Q35). */
@Injectable()
export class RolesService {
  constructor(
    private readonly db: TenantDb,
    private readonly sessions: SessionService,
  ) {}

  list(): Promise<RoleDto[]> {
    const actorScope = currentAuth().membership!.scope;
    return this.db.read(async (tx) => {
      const counts = await tx.membershipRole.groupBy({ by: ['roleCode'], _count: { _all: true }, where: { membership: { status: 'ACTIVE' } } });
      const custom = await tx.tenantRole.findMany({
        include: { permissions: { select: { permissionCode: true } }, _count: { select: { memberships: true } } },
        orderBy: { name: 'asc' },
      });
      const system: RoleDto[] = ROLE_CODES.filter((code) => ROLES[code].scope !== 'PLATFORM').map((code) => ({
        id: code,
        name: ROLES[code].name,
        description: null,
        scope: ROLES[code].scope,
        system: true,
        status: 'ACTIVE',
        permissions: [...ROLES[code].permissions],
        membersCount: counts.find((c) => c.roleCode === code)?._count._all ?? 0,
        updatedAt: null,
      }));
      const all = [...system, ...custom.map(toDto)];
      // Fora da Matriz, só os papéis do próprio tipo de organização.
      return actorScope === 'MATRIZ' ? all : all.filter((r) => r.scope === actorScope);
    });
  }

  create(input: CustomRoleInput): Promise<RoleDto> {
    const auth = currentAuth();
    return this.db.write(async (scope) => {
      const { tx } = scope;
      this.assertPermissions(input);
      this.assertNameFree(input.name);
      try {
        const role = await tx.tenantRole.create({
          data: { tenantId: auth.membership!.tenantId, name: input.name, description: input.description, scope: input.scope, createdBy: auth.userId },
        });
        await tx.tenantRolePermission.createMany({ data: input.permissions.map((permissionCode) => ({ roleId: role.id, tenantId: role.tenantId, permissionCode })) });
        await scope.audit({ entityType: 'role', entityId: role.id, action: 'role.created', after: { name: input.name, scope: input.scope, permissions: input.permissions } });
        return toDto(await this.load(tx, role.id));
      } catch (err) {
        throw this.mapUnique(err);
      }
    });
  }

  async update(id: string, input: CustomRoleInput): Promise<RoleDto> {
    const { dto, members } = await this.db.write(async (scope) => {
      const { tx } = scope;
      const role = await this.load(tx, id);
      if (role._count.memberships > 0 && role.scope !== input.scope) {
        throw AppError.domain(ErrorCode.VALIDATION_FAILED, 'Não é possível mudar o tipo de um papel que já está atribuído.', { fields: { scope: ['Remova o papel das pessoas antes'] } });
      }
      this.assertPermissions(input);
      this.assertNameFree(input.name);
      const before = { name: role.name, scope: role.scope, description: role.description, permissions: role.permissions.map((p) => p.permissionCode) };
      try {
        await tx.tenantRole.update({ where: { id }, data: { name: input.name, description: input.description, scope: input.scope } });
      } catch (err) {
        throw this.mapUnique(err);
      }
      await tx.tenantRolePermission.deleteMany({ where: { roleId: id } });
      await tx.tenantRolePermission.createMany({ data: input.permissions.map((permissionCode) => ({ roleId: id, tenantId: role.tenantId, permissionCode })) });
      await scope.audit({ entityType: 'role', entityId: id, action: 'role.updated', before, after: { name: input.name, scope: input.scope, description: input.description, permissions: input.permissions } });
      const users = await tx.membershipCustomRole.findMany({ where: { roleId: id }, select: { membership: { select: { userId: true } } } });
      return { dto: toDto(await this.load(tx, id)), members: users.map((u) => u.membership.userId) };
    });
    // Quem tem o papel passa a ter as permissões novas já na próxima requisição.
    await Promise.all([...new Set(members)].map((userId) => this.sessions.signalAuthzChange(userId)));
    return dto;
  }

  setStatus(id: string, status: 'ACTIVE' | 'ARCHIVED'): Promise<RoleDto> {
    return this.db.write(async (scope) => {
      const { tx } = scope;
      const role = await this.load(tx, id);
      if (role.status === status) return toDto(role);
      if (status === 'ARCHIVED' && role._count.memberships > 0) {
        throw AppError.domain(ErrorCode.VALIDATION_FAILED, `Este papel está atribuído a ${role._count.memberships} pessoa(s). Remova-o dos usuários antes de arquivar.`);
      }
      await tx.tenantRole.update({ where: { id }, data: { status } });
      await scope.audit({ entityType: 'role', entityId: id, action: status === 'ARCHIVED' ? 'role.archived' : 'role.restored', before: { status: role.status }, after: { status } });
      return toDto(await this.load(tx, id));
    });
  }

  private async load(tx: Tx, id: string): Promise<CustomRoleRow> {
    const role = await tx.tenantRole.findUnique({ where: { id }, include: { permissions: { select: { permissionCode: true } }, _count: { select: { memberships: true } } } });
    if (!role) throw AppError.notFound('Papel não encontrado.');
    return role;
  }

  /** Um papel personalizado só pode ter permissões que papéis do sistema do mesmo tipo já têm. */
  private assertPermissions(input: CustomRoleInput) {
    const allowed = new Set(permissionsAllowedForScope(input.scope));
    const blocked = input.permissions.filter((p) => !allowed.has(p));
    if (blocked.length) {
      throw AppError.domain(ErrorCode.VALIDATION_FAILED, `Permissões não disponíveis para este tipo de organização: ${blocked.map((p) => PERMISSIONS[p]).join('; ')}.`, {
        fields: { permissions: blocked },
      });
    }
  }

  private assertNameFree(name: string) {
    const clash = ROLE_CODES.some((code) => ROLES[code].name.toLowerCase() === name.trim().toLowerCase());
    if (clash) throw AppError.validation({ fields: { name: ['Já existe um papel do sistema com esse nome'] } });
  }

  private mapUnique(err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return AppError.validation({ fields: { name: ['Já existe um papel com esse nome'] } });
    }
    return err;
  }
}
