# Ambientes, Migrations e Seed

## Desenvolvimento

```bash
cp .env.example .env
docker compose up --build
```

Serviços: `postgres`, `redis`, `minio`, `minio-init`, `mailpit`, `migrate`, `api`, `worker`, `web`. Opcional: `docker compose --profile scan up` adiciona `clamav`.

- `migrate` (one-shot) roda `prisma migrate deploy` como `ordens_owner` e, se `SEED_DEMO=true`, o seed de demonstração. `api`/`worker` dependem de `migrate` concluído com sucesso (`service_completed_successfully`).
- Hot reload: `docker-compose.override.yml` monta o código e usa `next dev`, `nest start --watch` (SWC) e `tsx watch`.
- Senha dos usuários demo: `SEED_DEMO_PASSWORD`. Se vazia, o seed gera uma senha aleatória **uma vez** e imprime no log do `migrate` (`docker compose logs migrate`). Nenhuma senha em README.

URLs locais: web `http://localhost:3000`, API `http://localhost:4000` (Swagger `/docs`), MinIO console `http://localhost:9001`, Mailpit `http://localhost:8025`.

## Produção

**Servidor Linux único atrás de Cloudflare Tunnel: passo a passo em [deploy-producao.md](deploy-producao.md)**
(`docker-compose.prod.yml`, `.env.production` gerado por `scripts/deploy/gen-env.sh`, primeira empresa por
`packages/db` `bootstrap`, backup/restauração em `scripts/deploy/`).

- Imagens multi-stage non-root publicadas no GHCR.
- **Migration é um job explícito de release**, executado uma vez antes de subir a nova versão:
  `docker run --rm --env-file prod.env ghcr.io/<org>/ordens-migrate:<sha> migrate`
  No workflow `release.yml` é um job separado com `environment: production` e aprovação.
- `api` e `worker` **não** executam migrations no boot.
- Seed demo **nunca** roda: o script aborta se `NODE_ENV=production` ou `SEED_DEMO !== 'true'`.
- Seed de produção limitado a dados de referência idempotentes (permissões, papéis, unidades) executado pelo job de migration.
- Segredos via secret manager / variáveis do ambiente, nunca no repositório.

## Variáveis

Ver `.env.example`. Validadas com Zod no boot (`apps/api/src/config`); a aplicação não inicia com configuração inválida.

## Toolchain

- Node `24.19.0` (`.nvmrc`, `.node-version`, `engines`).
- pnpm `12.3.4` (`packageManager`).
- `pnpm install --frozen-lockfile` em CI e Docker; lockfile obrigatório.
