import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { twoFactorConfirmSchema, twoFactorDisableSchema, twoFactorVerifySchema } from '@ordens/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { AllowStages, SelfService } from '../../common/decorators.js';
import { currentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { clearSessionCookies, setSessionCookies } from './cookies.js';
import { SessionService } from './session.service.js';
import { TwoFactorService } from './two-factor.service.js';

@ApiTags('auth')
@SelfService()
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(
    private readonly twoFactor: TwoFactorService,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @AllowStages('ACTIVE', 'PENDING_2FA_SETUP')
  @Get('status')
  async status() {
    const { userId } = currentAuth();
    const [enabled, remainingRecoveryCodes] = await Promise.all([
      this.twoFactor.isEnabled(userId),
      this.twoFactor.remainingRecoveryCodes(userId),
    ]);
    return { enabled, remainingRecoveryCodes };
  }

  @AllowStages('ACTIVE', 'PENDING_2FA_SETUP')
  @Post('setup')
  @HttpCode(200)
  setup() {
    return this.twoFactor.setup();
  }

  @AllowStages('ACTIVE', 'PENDING_2FA_SETUP')
  @Post('confirm')
  @HttpCode(200)
  async confirm(
    @Body(new ZodPipe(twoFactorConfirmSchema)) body: z.infer<typeof twoFactorConfirmSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const auth = currentAuth();
    const result = await this.twoFactor.confirm(body.code);
    const promoted = await this.auth.promoteAfterSetup(auth);
    if (promoted) setSessionCookies(res, this.sessions, promoted.token, promoted.sessionId, true);
    return { ...result, stage: promoted?.stage ?? auth.stage };
  }

  @Post('disable')
  @HttpCode(204)
  async disable(
    @Body(new ZodPipe(twoFactorDisableSchema)) body: z.infer<typeof twoFactorDisableSchema>,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.twoFactor.disable(body.password, body.code);
    clearSessionCookies(res, this.sessions);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  regenerate(@Body(new ZodPipe(twoFactorVerifySchema)) body: z.infer<typeof twoFactorVerifySchema>) {
    return this.twoFactor.regenerateRecoveryCodes(body.code);
  }
}
