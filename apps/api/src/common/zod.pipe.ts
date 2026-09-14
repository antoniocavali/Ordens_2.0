import { type PipeTransform } from '@nestjs/common';
import type { ZodType } from 'zod';
import { AppError } from './errors.js';

/** Valida e transforma entrada com um schema Zod de @ordens/contracts. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.join('.') || '_';
        (fields[key] ??= []).push(issue.message);
      }
      throw AppError.validation({ fields });
    }
    return result.data;
  }
}
