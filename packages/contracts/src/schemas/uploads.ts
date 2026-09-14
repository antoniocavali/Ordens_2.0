import { z } from 'zod';
import { DOCUMENT_KINDS, type DocumentKind, type ScanStatus, type UploadStatus } from '../enums.js';

export const SINGLE_UPLOAD_MAX_BYTES = 16 * 1024 * 1024;
export const MULTIPART_PART_SIZE = 16 * 1024 * 1024;

/** Allowlist de tipos por categoria de documento. */
export const UPLOAD_RULES: Record<DocumentKind, { mimes: string[]; extensions: string[]; maxBytes: number }> = {
  NFE_XML: { mimes: ['application/xml', 'text/xml'], extensions: ['.xml'], maxBytes: 5 * 1024 * 1024 },
  PDF: { mimes: ['application/pdf'], extensions: ['.pdf'], maxBytes: 512 * 1024 * 1024 },
  IMAGE: {
    mimes: ['image/jpeg', 'image/png', 'image/webp'],
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
    maxBytes: 50 * 1024 * 1024,
  },
  SPREADSHEET: {
    mimes: ['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    extensions: ['.csv', '.xlsx'],
    maxBytes: 100 * 1024 * 1024,
  },
  OTHER: {
    mimes: ['application/pdf', 'application/zip', 'application/xml', 'text/xml', 'image/jpeg', 'image/png'],
    extensions: ['.pdf', '.zip', '.xml', '.jpg', '.jpeg', '.png'],
    maxBytes: 2 * 1024 * 1024 * 1024,
  },
};

export const UPLOAD_ENTITY_TYPES = ['loading_order', 'load', 'contract', 'partner', 'farm', 'occurrence', 'user'] as const;

export const initiateUploadSchema = z.object({
  entityType: z.enum(UPLOAD_ENTITY_TYPES),
  entityId: z.uuid(),
  kind: z.enum(DOCUMENT_KINDS),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .refine((n) => !/[\\/\0]/.test(n), 'Nome de arquivo inválido'),
  sizeBytes: z.number().int().positive(),
  mimeType: z.string().trim().min(3).max(127),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export type InitiateUploadInput = z.infer<typeof initiateUploadSchema>;

export const partUrlsSchema = z.object({
  partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(100),
});

export const completeUploadSchema = z.object({
  parts: z
    .array(z.object({ partNumber: z.number().int().min(1).max(10000), etag: z.string().min(1).max(200) }))
    .max(10000)
    .optional(),
});

export interface InitiateUploadResponse {
  uploadId: string;
  strategy: 'SINGLE' | 'MULTIPART';
  url?: string;
  headers?: Record<string, string>;
  partSize?: number;
  partCount?: number;
  expiresAt: string;
}

export interface UploadDto {
  id: string;
  entityType: string;
  entityId: string;
  kind: DocumentKind;
  fileName: string;
  sizeBytes: string;
  mimeType: string;
  status: UploadStatus;
  scanStatus: ScanStatus;
  sha256: string | null;
  createdAt: string;
  uploadedParts?: { partNumber: number; etag: string }[];
}
