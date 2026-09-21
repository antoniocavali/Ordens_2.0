import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { LockoutService } from './lockout.service.js';
import { PasskeyController } from './passkey.controller.js';
import { PasskeyService } from './passkey.service.js';
import { SessionService } from './session.service.js';
import { TwoFactorController } from './two-factor.controller.js';
import { TwoFactorService } from './two-factor.service.js';

@Module({
  controllers: [AuthController, TwoFactorController, PasskeyController],
  providers: [AuthService, SessionService, LockoutService, TwoFactorService, PasskeyService],
  exports: [SessionService, AuthService],
})
export class AuthModule {}
