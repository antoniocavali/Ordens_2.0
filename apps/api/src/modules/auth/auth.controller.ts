import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  loginSchema,
  passwordChangeSchema,
  passwordForgotSchema,
  passwordResetSchema,
  switchContextSchema,
  twoFactorVerifySchema,
  type LoginInput,
  type LoginResponse,
  type TwoFactorVerifyInput,
} from '@ordens/contracts';
import type { Response } from 'express';
import type { z } from 'zod';
import { AllowStages, Public } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { AuthService } from './auth.service.js';
import { clearSessionCookies, setSessionCookies } from './cookies.js';
import { SessionService } from './session.service.js';

const ANY_STAGE = ['ACTIVE', 'PENDING_2FA', 'PENDING_2FA_SETUP'] as const;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Res({ passthrough: true }) res: Response): Promise<LoginResponse> {
    const issued = await this.auth.login(body.email, body.password);
    setSessionCookies(res, this.sessions, issued.token, issued.sessionId, issued.stage === 'ACTIVE');
    return { stage: issued.stage };
  }

  @AllowStages('PENDING_2FA')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('2fa/verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodPipe(twoFactorVerifySchema)) body: TwoFactorVerifyInput,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const issued = await this.auth.verifySecondFactor(body.code);
    setSessionCookies(res, this.sessions, issued.token, issued.sessionId, true);
    return { stage: issued.stage };
  }

  @AllowStages(...ANY_STAGE)
  @Get('me')
  me() {
    return this.auth.me();
  }

  @AllowStages(...ANY_STAGE)
  @Post('logout')
  @HttpCode(204)
  async logout(@Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout();
    clearSessionCookies(res, this.sessions);
  }

  @Post('logout-all')
  @HttpCode(204)
  async logoutAll(@Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logoutAll();
    clearSessionCookies(res, this.sessions);
  }

  @Post('context')
  @AllowStages('ACTIVE', 'PENDING_2FA_SETUP')
  @HttpCode(200)
  async switchContext(
    @Body(new ZodPipe(switchContextSchema)) body: z.infer<typeof switchContextSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const issued = await this.auth.switchContext(body.membershipId);
    setSessionCookies(res, this.sessions, issued.token, issued.sessionId, true);
    return { stage: issued.stage };
  }

  @Get('sessions')
  sessionsList() {
    return this.auth.listSessions();
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  revoke(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.auth.revokeSession(id);
  }

  @Get('login-history')
  history() {
    return this.auth.loginHistory();
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('password/forgot')
  @HttpCode(202)
  async forgot(@Body(new ZodPipe(passwordForgotSchema)) body: z.infer<typeof passwordForgotSchema>) {
    await this.auth.forgotPassword(body.email);
    return { message: 'Se o e-mail estiver cadastrado, você receberá as instruções em instantes.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password/reset')
  @HttpCode(204)
  reset(@Body(new ZodPipe(passwordResetSchema)) body: z.infer<typeof passwordResetSchema>) {
    return this.auth.resetPassword(body.token, body.password);
  }

  @Post('password/change')
  @HttpCode(204)
  async change(
    @Body(new ZodPipe(passwordChangeSchema)) body: z.infer<typeof passwordChangeSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const issued = await this.auth.changePassword(body.currentPassword, body.newPassword, body.code);
    setSessionCookies(res, this.sessions, issued.token, issued.sessionId, true);
  }
}
