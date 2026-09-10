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
import { UsersService } from './users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [UsersController, OrganizationsController, SettingsController, AuditController, MeController, TenantsController],
  providers: [UsersService],
})
export class PlatformModule {}
