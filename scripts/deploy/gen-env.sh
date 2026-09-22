#!/usr/bin/env bash
# Gera o .env.production com segredos aleatórios (arquivo 0600). Não sobrescreve um arquivo existente.
#
#   PUBLIC_HOST=ordens.cooperfarms.digital ./scripts/deploy/gen-env.sh
#
# Depois edite o arquivo e preencha CLOUDFLARE_TUNNEL_TOKEN e os dados do servidor de e-mail (SMTP_*).
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT="${OUT_FILE:-.env.production}"
if [ -e "$OUT" ]; then
  echo "$OUT já existe. Apague-o ou edite à mão (isto evita trocar as senhas de um ambiente em uso)." >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "openssl não encontrado" >&2; exit 1; }

PUBLIC_HOST="${PUBLIC_HOST:-ordens.cooperfarms.digital}"
key32() { openssl rand -base64 32; }
hex() { openssl rand -hex "${1:-24}"; }

umask 077
cat > "$OUT" <<EOF
# Ambiente de produção — gerado em $(date -u +%Y-%m-%dT%H:%M:%SZ). NUNCA versionar este arquivo.

# Endereço público (o mesmo do túnel Cloudflare). Trocar depois invalida as passkeys cadastradas.
PUBLIC_HOST=${PUBLIC_HOST}

# Cloudflare Tunnel: token do túnel (Zero Trust › Networks › Tunnels).
CLOUDFLARE_TUNNEL_TOKEN=

# Banco de dados
POSTGRES_USER=postgres
POSTGRES_DB=ordens
POSTGRES_PASSWORD=$(hex 24)
ORDENS_OWNER_PASSWORD=$(hex 24)
ORDENS_APP_PASSWORD=$(hex 24)

# Armazenamento de arquivos (MinIO)
S3_ACCESS_KEY=ordens-$(hex 4)
S3_SECRET_KEY=$(hex 24)

# Chaves da aplicação (32 bytes em base64). GUARDE UMA CÓPIA FORA DO SERVIDOR: sem elas, sessões,
# senhas de pasta de rede e segredos de 2FA cadastrados deixam de funcionar.
SESSION_SECRET=$(key32)
TWO_FACTOR_ENC_KEY=$(key32)

# E-mail (avisos, convites e redefinição de senha) pelo Microsoft 365 via Graph. A TI registra um
# aplicativo no Entra ID e o limita a UMA caixa no Exchange Online (roteiro: docs/deploy-producao.md).
MAIL_TRANSPORT=graph
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_SENDER=nao-responda@cooperfarms.digital

# Alternativa por SMTP (MAIL_TRANSPORT=smtp): 587 com STARTTLS (SMTP_REQUIRE_TLS=true) ou 465 com TLS
# direto (SMTP_SECURE=true, SMTP_REQUIRE_TLS=false). O Microsoft 365 desliga o SMTP com senha por padrão
# no fim de dezembro de 2026.
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASSWORD=
# SMTP_SECURE=false
# SMTP_REQUIRE_TLS=true
# MAIL_FROM=Ordens Cooperfarms <nao-responda@cooperfarms.digital>

# Opcionais
LOG_LEVEL=info
SESSION_IDLE_HOURS=12
SESSION_ABSOLUTE_DAYS=7
# Pastas locais do servidor liberadas para a cópia do XML (caminhos de rede não precisam estar aqui).
XML_ARCHIVE_LOCAL_ROOTS=
IMAGE_TAG=latest
EOF
chmod 600 "$OUT"
echo "Criado $OUT (permissão 600). Preencha CLOUDFLARE_TUNNEL_TOKEN e SMTP_* antes de subir."
