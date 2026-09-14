import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { customRoleInputSchema, type CustomRoleInput } from '@ordens/contracts';
import { RequireAnyPermission, RequirePermission } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { RolesService } from './roles.service.js';

const uuid = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Papéis disponíveis para atribuir (convite/edição de usuário) e para gerenciar. */
  @Get()
  @RequireAnyPermission('user.read', 'user.manage', 'role.manage')
  list() {
    return this.roles.list();
  }

  @Post()
  @RequirePermission('role.manage')
  create(@Body(new ZodPipe(customRoleInputSchema)) body: CustomRoleInput) {
    return this.roles.create(body);
  }

  @Put(':id')
  @RequirePermission('role.manage')
  update(@Param('id', uuid) id: string, @Body(new ZodPipe(customRoleInputSchema)) body: CustomRoleInput) {
    return this.roles.update(id, body);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('role.manage')
  archive(@Param('id', uuid) id: string) {
    return this.roles.setStatus(id, 'ARCHIVED');
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('role.manage')
  restore(@Param('id', uuid) id: string) {
    return this.roles.setStatus(id, 'ACTIVE');
  }
}
