#!/usr/bin/env bash
# Restaura um dump do banco.
#
#   ./scripts/deploy/restore-db.sh /srv/backups/ordens/db/ordens-AAAAMMDD-HHMMSS.dump
#       Teste seguro: restaura em um banco separado (ordens_restore_check) e mostra contagens.
#       Não mexe no banco em uso. Faça isto periodicamente para provar que o backup funciona.
#
#   ./scripts/deploy/restore-db.sh <dump> --replace
#       RECUPERAÇÃO: para a aplicação, APAGA o banco em uso, restaura o dump e sobe a aplicação.
set -euo pipefail
cd "$(dirname "$0")/../.."

DUMP="${1:?informe o arquivo .dump}"
MODE="${2:-test}"
ENV_FILE="${ENV_FILE:-.env.production}"
# COMPOSE_FILE permite acrescentar arquivos (ex.: testes locais); o padrão é o compose de produção.
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose --env-file "$ENV_FILE")
[ -f "$DUMP" ] || { echo "arquivo não encontrado: $DUMP" >&2; exit 1; }

psql_admin() { "${COMPOSE[@]}" exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -v ON_ERROR_STOP=1 -d postgres "$@"' sh "$@"; }

if [ "$MODE" = "--replace" ]; then
  echo "ATENÇÃO: isto APAGA o banco em uso e o substitui por $DUMP."
  read -r -p "Digite RESTAURAR para continuar: " answer
  [ "$answer" = "RESTAURAR" ] || { echo "cancelado"; exit 1; }
  "${COMPOSE[@]}" stop api worker web cloudflared
  TARGET="$("${COMPOSE[@]}" exec -T postgres sh -c 'echo "$POSTGRES_DB"')"
else
  TARGET="ordens_restore_check"
fi

echo "[restore] recriando o banco $TARGET"
psql_admin -c "DROP DATABASE IF EXISTS $TARGET WITH (FORCE)" -c "CREATE DATABASE $TARGET OWNER ordens_owner"

echo "[restore] restaurando $DUMP"
# O dump traz dono, permissões e políticas RLS; as extensões e os papéis já existem no servidor.
"${COMPOSE[@]}" exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $TARGET --exit-on-error" < "$DUMP"

if [ "$MODE" = "--replace" ]; then
  echo "[restore] subindo a aplicação"
  "${COMPOSE[@]}" up -d
  echo "[restore] concluído."
else
  echo "[restore] conferência das tabelas principais em $TARGET:"
  "${COMPOSE[@]}" exec -T postgres sh -c "psql -U \"\$POSTGRES_USER\" -d $TARGET -At -c \"select 'usuarios', count(*) from users union all select 'ordens', count(*) from loading_orders union all select 'cargas', count(*) from loads union all select 'notas', count(*) from invoices union all select 'auditoria', count(*) from audit_events\""
  psql_admin -c "DROP DATABASE $TARGET WITH (FORCE)" > /dev/null
  echo "[restore] teste concluído; o banco temporário foi removido."
fi
