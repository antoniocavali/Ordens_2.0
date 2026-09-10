#!/bin/sh
# Cria buckets privados e aplica política de ciclo de vida na quarentena.
set -eu

mc alias set local http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY"

for bucket in "$S3_BUCKET_QUARANTINE" "$S3_BUCKET_DOCUMENTS"; do
  mc mb --ignore-existing "local/$bucket"
  # Nunca público.
  mc anonymous set none "local/$bucket"
done

# Objetos esquecidos na quarentena expiram em 7 dias; multiparts incompletos em 2 dias.
mc ilm rule add --expire-days 7 "local/$S3_BUCKET_QUARANTINE" >/dev/null 2>&1 || true
mc ilm rule add --noncurrent-expire-days 2 "local/$S3_BUCKET_QUARANTINE" >/dev/null 2>&1 || true

echo "Buckets prontos: $S3_BUCKET_QUARANTINE, $S3_BUCKET_DOCUMENTS"
