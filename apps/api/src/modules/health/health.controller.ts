import { Controller, Get, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Database } from '@ordens/db';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { Public } from '../../common/decorators.js';
import { REDIS } from '../../infra/infra.module.js';
import { StorageService } from '../../infra/storage.service.js';

@ApiTags('health')
@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly storage: StorageService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks = await Promise.allSettled([this.db.ping(), this.redis.ping(), this.storage.ping()]);
    const [postgres, redis, storage] = checks.map((c) => (c.status === 'fulfilled' ? 'up' : 'down'));
    const ok = checks.every((c) => c.status === 'fulfilled');
    res.status(ok ? 200 : 503);
    return { status: ok ? 'ok' : 'degraded', checks: { postgres, redis, storage } };
  }
}
