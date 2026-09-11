# Estratégia de Upload e Documentos

## Princípios

- O arquivo vai **direto do navegador para S3/MinIO** via URL pré-assinada. Não atravessa Next.js nem NestJS.
- Backend **autoriza** (usuário, tenant, organização, entidade, tipo, tamanho), **registra** (`file_uploads`) e **finaliza**.
- Processamento (checksum real, detecção de tipo por magic bytes, antivírus, parsing NF-e) é **assíncrono** no worker.
- Buckets **privados**; nada público; downloads via presigned GET de curta duração (60 s) e auditados para documentos críticos.
- Filesystem de container nunca é armazenamento definitivo; o worker processa via stream.

## Buckets e chaves

| Bucket | Conteúdo |
|---|---|
| `ordens-quarantine` | upload recém-recebido, ainda não verificado |
| `ordens-documents` | arquivo verificado e disponível |

Chave: `t/{tenantId}/{yyyy}/{mm}/{uuid}` — sem nome original (evita enumeração e injeção de path). Nome original fica só no banco.

## Fluxo

```mermaid
sequenceDiagram
  participant B as Browser
  participant A as API
  participant S as S3/MinIO
  participant Q as BullMQ
  participant W as Worker
  B->>A: POST /uploads {entityType, entityId, kind, name, size, mime, sha256?, idempotencyKey}
  A->>A: permissão + RLS da entidade + validação MIME/extensão/tamanho
  alt size <= 16 MiB
    A-->>B: {uploadId, strategy: SINGLE, url (PUT, 15 min), headers}
    B->>S: PUT (progresso via XHR)
  else multipart
    A->>S: CreateMultipartUpload
    A-->>B: {uploadId, strategy: MULTIPART, partSize}
    B->>A: POST /uploads/:id/parts {partNumbers:[1..n]}
    A-->>B: URLs presigned por parte
    B->>S: PUT partes (concorrência 4, retry exponencial por parte)
  end
  B->>A: POST /uploads/:id/complete {parts:[{n, etag}]}
  A->>S: CompleteMultipartUpload / HeadObject (tamanho confere)
  A->>A: status UPLOADED + audit + outbox upload.completed (mesma transação)
  Q->>W: file-processing
  W->>S: stream: sha256, magic bytes
  W->>W: antivírus (ClamAV ou SKIPPED_DEV)
  W->>S: CopyObject quarantine → documents; DeleteObject quarantine
  W->>A: status AVAILABLE (ou REJECTED/INFECTED) + outbox upload.available
```

## Estados

`PENDING → UPLOADING → UPLOADED → PROCESSING → AVAILABLE`; ramificações `REJECTED` (tipo/tamanho/checksum), `INFECTED`, `ABORTED`, `EXPIRED`.

`scan_status`: `PENDING | CLEAN | INFECTED | ERROR | SKIPPED_DEV`. Em produção, `SKIPPED_DEV` é proibido por configuração (API recusa iniciar se `NODE_ENV=production` e `SCANNER=noop`).

## Validações

- Allowlist por `document_kind` (ex.: `NFE_XML`: `application/xml`, `text/xml`, `.xml`, ≤ 5 MiB; `PDF`: `application/pdf`; imagens `image/jpeg|png|webp`).
- Tamanho máximo global configurável (`UPLOAD_MAX_BYTES`, padrão 2 GiB).
- Extensão × MIME declarado × MIME detectado (worker) devem ser coerentes.
- SHA-256 declarado pelo navegador (opcional; calculado em Web Worker) é comparado com o real.

## Visibilidade e NF-e (Fase 8)

- `file_uploads.visibility`: `INTERNAL` (só Matriz), `FARM`, `BUYER`, `PARTIES`. Organizações da entidade (ordem, carga, ocorrência) são copiadas por trigger e usadas pelo RLS; quem enviou sempre enxerga o próprio arquivo.
- Padrão (Q18): enviados pela Matriz → `INTERNAL`; pela Fazenda → `FARM`; XML de NF-e → `PARTIES`; cadastros e contratos sempre `INTERNAL`. Só a Matriz altera (`PATCH /documents/:id/visibility`, auditado).
- `NFE_XML` só pode ser anexado a uma **carga** e exige `invoice.upload`. Após `upload.available`, a fila `invoices` lê o XML (sem DTD/entidades), valida a chave (DV módulo 11) e o protocolo, registra `invoices` com divergências (emitente × vendedor, placa × carga, peso × tolerância) ou rejeição, e grava auditoria + outbox na mesma transação. Idempotente por `file_upload_id`.

## Idempotência e retentativas

- `idempotency_key` único por tenant: repetir `POST /uploads` retorna o mesmo registro.
- `complete` é idempotente (estado já `UPLOADED` → 200).
- Jobs usam `jobId = file_upload_id` e checam estado antes de agir.
- Job agendado `upload-maintenance` aborta multiparts `UPLOADING` com mais de 24 h e marca `EXPIRED`.

## Central de uploads (web)

Fila global (store fora da árvore de rotas) → uploads continuam ao navegar dentro do app. Drag-and-drop, múltiplos arquivos, progresso individual e geral, cancelamento (`AbortController` + `POST /uploads/:id/abort`), retry por parte, erros legíveis. Pausa/retomada de multipart: partes concluídas são lembradas no `sessionStorage` e `GET /uploads/:id` lista partes já recebidas (`ListParts`).

## ClamAV

Serviço em compose profile `scan` (`docker compose --profile scan up`). CI e staging habilitam. Worker usa `SCANNER=clamav|noop`.
