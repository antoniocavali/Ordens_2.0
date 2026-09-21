#!/usr/bin/env bash
# Backup do banco (pg_dump) e dos documentos (espelho do bucket) para BACKUP_DIR.
# Rodar pelo timer do systemd (deploy/systemd) e copiar BACKUP_DIR para FORA do servidor.
#
#   BACKUP_DIR=/srv/backups/ordens BACKUP_KEEP_DAYS=30 ./scripts/deploy/backup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

BACKUP_DIR="${BACKUP_DIR:-/srv/backups/ordens}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
ENV_FILE="${ENV_FILE:-.env.production}"
# COMPOSE_FILE permite acrescentar arquivos (ex.: testes locais); o padrão é o compose de produção.
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose --env-file "$ENV_FILE")

umask 077
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/files"
ts="$(date +%Y%m%d-%H%M%S)"
dump="$BACKUP_DIR/db/ordens-$ts.dump"

echo "[backup] banco → $dump"
# Formato custom: compacto e permite restaurar tabelas isoladas. Grava em .partial e só renomeia se íntegro.
"${COMPOSE[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$dump.partial"
"${COMPOSE[@]}" exec -T postgres pg_restore --list < "$dump.partial" > /dev/null
mv "$dump.partial" "$dump"

echo "[backup] documentos → $BACKUP_DIR/files"
# Espelho incremental do bucket de documentos. Nada é apagado no destino; as exportações de relatório
# (expiram em 7 dias e podem ser geradas de novo) ficam de fora.
"${COMPOSE[@]}" run --rm --no-deps -T -v "$BACKUP_DIR/files:/backup" --entrypoint /bin/sh minio-init -c '
  set -eu
  mc alias set src http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" > /dev/null
  mc mirror --overwrite --exclude "*/relatorios/*" "src/$S3_BUCKET_DOCUMENTS" "/backup/$S3_BUCKET_DOCUMENTS"
'

echo "[backup] removendo dumps com mais de $BACKUP_KEEP_DAYS dias"
find "$BACKUP_DIR/db" -name 'ordens-*.dump' -mtime "+$BACKUP_KEEP_DAYS" -delete

date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/last-success"
echo "[backup] concluído: $(du -sh "$dump" | cut -f1) de banco"
