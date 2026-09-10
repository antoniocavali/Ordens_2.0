import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ErrorCode } from '@ordens/contracts';
import type { Response } from 'express';
import { AppError } from './errors.js';
import { requestContext } from './request-context.js';

interface PgLikeError {
  code?: string;
  message?: string;
  meta?: { driverAdapterError?: { cause?: { originalCode?: string; originalMessage?: string; hint?: string } } };
  cause?: { code?: string; hint?: string; message?: string };
}

/**
 * Converte qualquer erro em resposta segura: código estável + mensagem amigável.
 * Stack, SQL e mensagens técnicas ficam apenas no log estruturado.
 */
@Catch()
export class GlobalErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = requestContext.getStore()?.requestId;
    const mapped = this.map(exception);

    if (mapped.status >= 500) {
      const err = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(`Erro não tratado [${requestId ?? '-'}]: ${err.message}`, err.stack);
    } else if (mapped.status !== 401 && mapped.status !== 404 && mapped.status !== 422) {
      this.logger.warn({ code: mapped.code, requestId, reason: (exception as Error)?.message }, 'Requisição rejeitada');
    }

    if (res.headersSent) return;
    res.status(mapped.status).json({
      error: { code: mapped.code, message: mapped.message, details: mapped.details, requestId },
    });
  }

  private map(exception: unknown): { status: number; code: string; message: string; details?: unknown } {
    if (exception instanceof AppError) {
      return { status: exception.status, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof ThrottlerException) {
      return { status: 429, code: ErrorCode.RATE_LIMITED, message: 'Muitas tentativas. Aguarde alguns instantes.' };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 404) return { status, code: ErrorCode.NOT_FOUND, message: 'Recurso não encontrado.' };
      if (status === 413) return { status, code: ErrorCode.VALIDATION_FAILED, message: 'Conteúdo muito grande.' };
      if (status < 500) return { status, code: ErrorCode.VALIDATION_FAILED, message: 'Requisição inválida.' };
    }

    const db = this.mapDatabase(exception as PgLikeError);
    if (db) return db;

    return { status: 500, code: ErrorCode.INTERNAL_ERROR, message: 'Ocorreu um erro inesperado. Tente novamente.' };
  }

  private mapDatabase(err: PgLikeError | undefined) {
    if (!err || typeof err !== 'object') return null;
    const cause = err.meta?.driverAdapterError?.cause;
    const pgCode = cause?.originalCode ?? err.cause?.code;
    const hint = cause?.hint ?? err.cause?.hint;
    const text = `${cause?.originalMessage ?? ''} ${err.message ?? ''}`;

    if (err.code === 'P2002' || pgCode === '23505') {
      return { status: 409, code: ErrorCode.CONFLICT, message: 'Já existe um registro com estes dados.' };
    }
    if (err.code === 'P2025') {
      return { status: 404, code: ErrorCode.NOT_FOUND, message: 'Registro não encontrado.' };
    }
    if (hint === 'INCONSISTENT_RELATION' || text.includes('INCONSISTENT_RELATION')) {
      return { status: 422, code: ErrorCode.INCONSISTENT_RELATION, message: 'Os dados relacionados são inconsistentes.' };
    }
    if (pgCode === '42501' || text.includes('row-level security')) {
      return { status: 403, code: ErrorCode.FORBIDDEN, message: 'Você não tem permissão para esta ação.' };
    }
    if (pgCode === '23514' || pgCode === '23503') {
      return { status: 422, code: ErrorCode.VALIDATION_FAILED, message: 'Os dados informados não são válidos.' };
    }
    return null;
  }
}
