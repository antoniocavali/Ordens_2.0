import { z } from 'zod';

/** Códigos de erro estáveis expostos pela API. Mensagens técnicas nunca chegam ao usuário. */
export const ErrorCode = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  TWO_FACTOR_SETUP_REQUIRED: 'TWO_FACTOR_SETUP_REQUIRED',
  PASSWORD_CHANGE_REQUIRED: 'PASSWORD_CHANGE_REQUIRED',
  TWO_FACTOR_INVALID: 'TWO_FACTOR_INVALID',
  /** Passkey recusada (assinatura inválida, desafio vencido ou credencial desconhecida). */
  PASSKEY_INVALID: 'PASSKEY_INVALID',
  CSRF_INVALID: 'CSRF_INVALID',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  ORDER_STALE: 'ORDER_STALE',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INCONSISTENT_RELATION: 'INCONSISTENT_RELATION',
  QUANTITY_EXCEEDS_RELEASED: 'QUANTITY_EXCEEDS_RELEASED',
  RELEASE_EXCEEDS_ORDER: 'RELEASE_EXCEEDS_ORDER',
  RELEASE_BELOW_COMMITTED: 'RELEASE_BELOW_COMMITTED',
  CONTRACT_BALANCE_EXCEEDED: 'CONTRACT_BALANCE_EXCEEDED',
  PUBLISH_REQUIREMENTS_MISSING: 'PUBLISH_REQUIREMENTS_MISSING',
  FOUR_EYES_REQUIRED: 'FOUR_EYES_REQUIRED',
  FISCAL_DOCUMENTS_REQUIRED: 'FISCAL_DOCUMENTS_REQUIRED',
  /** Conclusão pedida com cargas sem PDF/XML da Fazenda: exige aceite explícito da Matriz (Q45). */
  ORDER_DOCUMENTS_PENDING: 'ORDER_DOCUMENTS_PENDING',
  /** Faturamento/conclusão da carga sem a nota da Matriz: exige confirmação explícita (Q47). */
  MATRIZ_INVOICE_MISSING: 'MATRIZ_INVOICE_MISSING',
  UPLOAD_REJECTED: 'UPLOAD_REJECTED',
  INVOICE_REQUIRED: 'INVOICE_REQUIRED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
