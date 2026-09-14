import { ErrorCode } from '@ordens/contracts';

/** Erro de aplicação com código estável e mensagem segura para o usuário. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static validation(details: unknown, message = 'Verifique os campos destacados.') {
    return new AppError(ErrorCode.VALIDATION_FAILED, 422, message, details);
  }
  static unauthenticated(message = 'Sua sessão expirou. Entre novamente.') {
    return new AppError(ErrorCode.UNAUTHENTICATED, 401, message);
  }
  static forbidden(message = 'Você não tem permissão para esta ação.') {
    return new AppError(ErrorCode.FORBIDDEN, 403, message);
  }
  static notFound(message = 'Registro não encontrado.') {
    return new AppError(ErrorCode.NOT_FOUND, 404, message);
  }
  static conflict(message: string, code: ErrorCode = ErrorCode.CONFLICT, details?: unknown) {
    return new AppError(code, 409, message, details);
  }
  static domain(code: ErrorCode, message: string, details?: unknown) {
    return new AppError(code, 422, message, details);
  }
}
