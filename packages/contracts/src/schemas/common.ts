import { z } from 'zod';

export const uuid = z.uuid();

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const cursorQuery = z.object({
  q: z.string().trim().max(120).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CursorQuery = z.infer<typeof cursorQuery>;

export const sortQuery = z.object({
  sort: z
    .string()
    .regex(/^[a-zA-Z_]+:(asc|desc)$/)
    .optional(),
});

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** Opção padrão de combobox assíncrono. */
export interface LookupOption {
  id: string;
  label: string;
  description?: string;
  meta?: Record<string, string | null>;
}
