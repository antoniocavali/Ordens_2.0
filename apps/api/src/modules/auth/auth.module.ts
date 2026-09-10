import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LockoutService } from './lockout.service.js';
import { SessionService } from './session.service.js';
import { TwoFactorController } from './two-factor.controller.js';
import { TwoFactorService } from './two-factor.service.js';

@Module({
  controllers: [AuthController, TwoFactorController],
  providers: [AuthService, SessionService, LockoutService, TwoFactorService],
  exports: [SessionService, AuthService],
})
export class AuthModule {}
