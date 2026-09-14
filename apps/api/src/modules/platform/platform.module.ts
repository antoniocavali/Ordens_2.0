import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import {
  AuditController,
  MeController,
  OrganizationsController,
  SettingsController,
  TenantsController,
  UsersController,
} from './platform.controllers.js';
import { RolesController } from './roles.controller.js';
import { RolesService } from './roles.service.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, RolesController, OrganizationsController, SettingsController, AuditController, MeController, TenantsController],
  providers: [UsersService, RolesService],
})
export class PlatformModule {}
