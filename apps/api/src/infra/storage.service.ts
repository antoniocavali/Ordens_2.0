import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';

/**
 * Abstração de object storage (S3/MinIO). O arquivo nunca trafega pela API:
 * aqui só geramos URLs pré-assinadas e controlamos o ciclo do multipart.
 */
@Injectable()
export class StorageService {
  /** Cliente para operações servidor → storage (rede interna). */
  private readonly internal: S3Client;
  /** Cliente usado apenas para assinar URLs com o endpoint público visto pelo navegador. */
  private readonly presigner: S3Client;

  readonly quarantineBucket: string;
  readonly documentsBucket: string;

  constructor(@Inject(ENV) env: Env) {
    const common = {
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    };
    this.internal = new S3Client({ ...common, endpoint: env.S3_ENDPOINT });
    this.presigner = new S3Client({ ...common, endpoint: env.S3_PUBLIC_ENDPOINT });
    this.quarantineBucket = env.S3_BUCKET_QUARANTINE;
    this.documentsBucket = env.S3_BUCKET_DOCUMENTS;
  }

  presignPut(bucket: string, key: string, contentType: string, contentLength: number, expiresIn = 900): Promise<string> {
    return getSignedUrl(
      this.presigner,
      new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength }),
      { expiresIn, signableHeaders: new Set(['content-type']) },
    );
  }

  async createMultipart(bucket: string, key: string, contentType: string): Promise<string> {
    const out = await this.internal.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
    if (!out.UploadId) throw new Error('Storage não retornou UploadId');
    return out.UploadId;
  }

  presignPart(bucket: string, key: string, uploadId: string, partNumber: number, expiresIn = 3600): Promise<string> {
    return getSignedUrl(
      this.presigner,
      new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn },
    );
  }

  async listParts(bucket: string, key: string, uploadId: string): Promise<{ partNumber: number; etag: string }[]> {
    const out = await this.internal.send(new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    return (out.Parts ?? []).map((p) => ({ partNumber: p.PartNumber!, etag: p.ETag! }));
  }

  async completeMultipart(bucket: string, key: string, uploadId: string, parts: { partNumber: number; etag: string }[]) {
    await this.internal.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: [...parts].sort((a, b) => a.partNumber - b.partNumber).map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
        },
      }),
    );
  }

  async abortMultipart(bucket: string, key: string, uploadId: string): Promise<void> {
    await this.internal.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
  }

  /** Retorna tamanho do objeto ou null se não existir. */
  async head(bucket: string, key: string): Promise<{ size: number; contentType?: string } | null> {
    try {
      const out = await this.internal.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { size: Number(out.ContentLength ?? 0), contentType: out.ContentType };
    } catch (err) {
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  presignGet(bucket: string, key: string, fileName: string, expiresIn = 60): Promise<string> {
    const safeName = fileName.replace(/["\\\r\n]/g, '_');
    return getSignedUrl(
      this.presigner,
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      }),
      { expiresIn },
    );
  }

  async ping(): Promise<void> {
    await this.internal.send(new HeadBucketCommand({ Bucket: this.quarantineBucket }));
  }
}
