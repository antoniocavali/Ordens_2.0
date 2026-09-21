import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { DEFAULT_XML_ARCHIVE_TEMPLATE, xmlArchiveSettingsSchema, type XmlArchiveSettingsDto } from '@ordens/contracts';
import type { Prisma, Tx } from '@ordens/db';
import type { z } from 'zod';
import { RequirePermission } from '../../common/decorators.js';
import { AppError } from '../../common/errors.js';
import { currentAuth } from '../../common/request-context.js';
import { ZodPipe } from '../../common/zod.pipe.js';
import { ENV, type Env } from '../../config/env.js';
import { TenantDb } from '../../infra/tenant-db.service.js';
import { encrypt } from '../auth/crypto.js';

const PENDING_WHERE: Prisma.InvoiceWhereInput = { archivedAt: null, origin: 'FARM', status: { in: ['VALID', 'DIVERGENT'] } };

/** Chave da senha da pasta de rede, derivada da chave de cifragem (o worker deriva igual). */
export function archiveKey(encKeyBase64: string) {
  return new Uint8Array(createHash('sha256').update(`xml-archive:${encKeyBase64}`).digest());
}

/**
 * Cópia do XML da Fazenda em pasta de rede. O endereço pode mudar a qualquer momento: as notas
 * ainda não copiadas passam a ir para o novo destino. Quem copia é o worker.
 */
@ApiTags('settings')
@Controller('settings/xml-archive')
export class XmlArchiveController {
  private readonly key: Uint8Array;

  constructor(
    private readonly db: TenantDb,
    @Inject(ENV) env: Env,
  ) {
    this.key = archiveKey(env.TWO_FACTOR_ENC_KEY);
  }

  @Get()
  @RequirePermission('settings.manage')
  get(): Promise<XmlArchiveSettingsDto> {
    return this.db.read((tx) => this.dto(tx));
  }

  @Put()
  @RequirePermission('settings.manage')
  update(@Body(new ZodPipe(xmlArchiveSettingsSchema)) body: z.output<typeof xmlArchiveSettingsSchema>): Promise<XmlArchiveSettingsDto> {
    const auth = currentAuth();
    const tenantId = auth.membership!.tenantId;
    return this.db.write(async (scope) => {
      const before = await scope.tx.xmlArchiveSettings.findUnique({ where: { tenantId } });
      const passwordEnc = body.clearPassword ? null : body.password ? Buffer.from(encrypt(this.key, body.password)) : undefined;
      const data = {
        enabled: body.enabled,
        path: body.path,
        domain: body.domain || null,
        username: body.username || null,
        folderTemplate: body.folderTemplate,
        updatedBy: auth.userId,
        updatedAt: new Date(),
        ...(passwordEnc !== undefined ? { passwordEnc } : {}),
        // Destino novo: o último teste não vale mais.
        ...(before && before.path !== body.path ? { lastTestAt: null, lastTestOk: null, lastTestMessage: null } : {}),
      };
      const after = await scope.tx.xmlArchiveSettings.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
      const view = (s: typeof before) =>
        s ? { enabled: s.enabled, path: s.path, domain: s.domain, username: s.username, folderTemplate: s.folderTemplate, hasPassword: Boolean(s.passwordEnc) } : null;
      await scope.audit({
        entityType: 'tenant',
        entityId: tenantId,
        action: 'tenant.xml_archive_updated',
        before: view(before),
        after: { ...view(after), passwordChanged: passwordEnc !== undefined },
      });
      // Ao ativar ou trocar o destino, as notas pendentes seguem para a pasta atual.
      if (after.enabled && (!before?.enabled || before.path !== after.path)) {
        await scope.outbox({ type: 'xml_archive.retry_requested', aggregateType: 'tenant', aggregateId: tenantId, payload: { reason: 'settings_changed' } });
      }
      return this.dto(scope.tx);
    });
  }

  /** Grava e apaga um arquivo de teste na pasta; o resultado aparece na tela em instantes. */
  @Post('test')
  @RequirePermission('settings.manage')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(202)
  async test(): Promise<{ requestedAt: string }> {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async (scope) => {
      const s = await scope.tx.xmlArchiveSettings.findUnique({ where: { tenantId } });
      if (!s?.path) throw AppError.domain('VALIDATION_FAILED', 'Salve a pasta antes de testar.');
      await scope.tx.xmlArchiveSettings.update({ where: { tenantId }, data: { lastTestAt: null, lastTestOk: null, lastTestMessage: null } });
      await scope.audit({ entityType: 'tenant', entityId: tenantId, action: 'tenant.xml_archive_tested', metadata: { path: s.path } });
      await scope.outbox({ type: 'xml_archive.test_requested', aggregateType: 'tenant', aggregateId: tenantId, payload: {} });
      return { requestedAt: new Date().toISOString() };
    });
  }

  /** Reenvia as notas ainda não copiadas (inclusive as que esgotaram as tentativas). */
  @Post('retry')
  @RequirePermission('settings.manage')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  async retry(): Promise<{ pending: number }> {
    const tenantId = currentAuth().membership!.tenantId;
    return this.db.write(async (scope) => {
      const s = await scope.tx.xmlArchiveSettings.findUnique({ where: { tenantId } });
      if (!s?.enabled) throw AppError.domain('VALIDATION_FAILED', 'Ative a cópia antes de reenviar.');
      const pending = await scope.tx.invoice.count({ where: PENDING_WHERE });
      await scope.tx.invoice.updateMany({ where: { ...PENDING_WHERE, archiveAttempts: { gt: 0 } }, data: { archiveAttempts: 0 } });
      await scope.audit({ entityType: 'tenant', entityId: tenantId, action: 'tenant.xml_archive_retried', metadata: { pending } });
      await scope.outbox({ type: 'xml_archive.retry_requested', aggregateType: 'tenant', aggregateId: tenantId, payload: { reason: 'manual' } });
      return { pending };
    });
  }

  private async dto(tx: Tx): Promise<XmlArchiveSettingsDto> {
    const tenantId = currentAuth().membership!.tenantId;
    const [s, copied, pending, failed, lastFailed] = await Promise.all([
      tx.xmlArchiveSettings.findUnique({ where: { tenantId } }),
      tx.invoice.count({ where: { archivedAt: { not: null } } }),
      tx.invoice.count({ where: { ...PENDING_WHERE, archiveError: null } }),
      tx.invoice.count({ where: { ...PENDING_WHERE, archiveError: { not: null } } }),
      tx.invoice.findFirst({ where: { ...PENDING_WHERE, archiveError: { not: null } }, orderBy: { updatedAt: 'desc' }, select: { archiveError: true } }),
    ]);
    return {
      enabled: s?.enabled ?? false,
      path: s?.path ?? '',
      domain: s?.domain ?? null,
      username: s?.username ?? null,
      hasPassword: Boolean(s?.passwordEnc),
      folderTemplate: s?.folderTemplate ?? DEFAULT_XML_ARCHIVE_TEMPLATE,
      lastTest: s?.lastTestAt ? { at: s.lastTestAt.toISOString(), ok: Boolean(s.lastTestOk), message: s.lastTestMessage } : null,
      updatedAt: s?.updatedAt.toISOString() ?? null,
      stats: { copied, pending, failed, lastError: lastFailed?.archiveError ?? null },
    };
  }
}
