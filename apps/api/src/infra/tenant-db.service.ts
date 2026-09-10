import { Injectable } from '@nestjs/common';
import { Database, UnitOfWork, type RunOptions, type Tx, type UnitOfWorkScope } from '@ordens/db';
import { AppError } from '../common/errors.js';
import { actorMeta, currentAuth, currentRequest, dbContextFor } from '../common/request-context.js';

/**
 * Ponto único de acesso ao banco para código de requisição autenticada.
 * O contexto RLS vem sempre da sessão — nunca de parâmetros do cliente.
 */
@Injectable()
export class TenantDb {
  private readonly uow: UnitOfWork;

  constructor(readonly db: Database) {
    this.uow = new UnitOfWork(db);
  }

  /** Leitura/escrita simples com contexto RLS (transação curta). */
  read<T>(fn: (tx: Tx) => Promise<T>, options?: RunOptions): Promise<T> {
    return this.db.run(this.requireTenantContext(), fn, options);
  }

  /** Alteração de domínio com auditoria e outbox na mesma transação. */
  write<T>(fn: (scope: UnitOfWorkScope) => Promise<T>, options?: RunOptions): Promise<T> {
    return this.uow.run(this.requireTenantContext(), actorMeta(currentRequest()), fn, options);
  }

  /** Operações do próprio usuário sem tenant (conta, 2FA, sessões). */
  self<T>(fn: (scope: UnitOfWorkScope) => Promise<T>, options?: RunOptions): Promise<T> {
    const auth = currentAuth();
    return this.uow.run(dbContextFor(auth), actorMeta(currentRequest()), fn, options);
  }

  private requireTenantContext() {
    const auth = currentAuth();
    if (!auth.membership) throw AppError.forbidden('Selecione uma organização para continuar.');
    return dbContextFor(auth);
  }
}
