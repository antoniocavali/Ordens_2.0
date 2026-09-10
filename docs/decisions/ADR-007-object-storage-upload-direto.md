# ADR-007 — Object storage e upload direto desde a fundação

**Status**: Aceito · 2026-09-10

## Decisão
- `StorageService` (interface) + adapter S3 (`@aws-sdk/client-s3`); MinIO local.
- Buckets privados `ordens-quarantine` e `ordens-documents`; chaves não previsíveis por tenant.
- Browser envia direto ao storage (presigned PUT ≤ 16 MiB; multipart acima), API autoriza/registra/finaliza, worker valida checksum, magic bytes, antivírus e promove.
- `file_uploads` e filas existem desde a Fase 1, antes da Central de Documentos.
- ClamAV em compose profile `scan`; `SCANNER=noop` proibido em produção.

## Consequências
+ API e web não viram gargalo de banda/memória; arquitetura pronta para grandes volumes.
− CORS do bucket precisa permitir a origem do web e expor `ETag`.
