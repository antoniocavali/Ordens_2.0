import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  passkeyLoginSchema,
  passkeyRegisterOptionsSchema,
  passkeyRegisterSchema,
  passkeyRenameSchema,
  type LoginResponse,
} from '@ordens/contracts';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import type { Response } from 'express';
import type { z } from 'zod';
import { Public, SelfService } from '../../common/decorators.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { setSessionCookies } from './cookies.js';
import { PasskeyService } from './passkey.service.js';
import { SessionService } from './session.service.js';

@ApiTags('auth')
@SelfService()
@Controller('auth/passkeys')
export class PasskeyController {
  constructor(
    private readonly passkeys: PasskeyService,
    private readonly sessions: SessionService,
  ) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('login/options')
  @HttpCode(200)
  loginOptions() {
    return this.passkeys.loginOptions();
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(passkeyLoginSchema)) body: z.infer<typeof passkeyLoginSchema>, @Res({ passthrough: true }) res: Response): Promise<LoginResponse> {
    const issued = await this.passkeys.login(body.challengeId, body.response as unknown as AuthenticationResponseJSON);
    setSessionCookies(res, this.sessions, issued.token, issued.sessionId, issued.stage === 'ACTIVE');
    return { stage: issued.stage };
  }

  @Get()
  list() {
    return this.passkeys.list();
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register/options')
  @HttpCode(200)
  registerOptions(@Body(new ZodPipe(passkeyRegisterOptionsSchema)) body: z.infer<typeof passkeyRegisterOptionsSchema>) {
    return this.passkeys.registrationOptions(body.password);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(@Body(new ZodPipe(passkeyRegisterSchema)) body: z.infer<typeof passkeyRegisterSchema>) {
    return this.passkeys.register(body.name, body.response as unknown as RegistrationResponseJSON);
  }

  @Patch(':id')
  @HttpCode(204)
  rename(@Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(passkeyRenameSchema)) body: z.infer<typeof passkeyRenameSchema>) {
    return this.passkeys.rename(id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.passkeys.remove(id);
  }
}
