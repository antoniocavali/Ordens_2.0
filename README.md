# Ordens · TMS

Plataforma SaaS/TMS multi-tenant para gestão de **Ordens de Carregamento** no agronegócio: contratos, ordens, liberações parciais, faróis de visualização por versão, uploads diretos para object storage e auditoria transacional.

Documentação de arquitetura: [docs/](docs/README.md).

## Stack

Next.js 16 · React 19 · Tailwind 4 · Radix · Motion · TanStack Query/Table — NestJS 12 · Prisma 7 · PostgreSQL 17 (RLS) · Redis 7 · BullMQ · MinIO (S3) — pnpm 12 + Turborepo · Docker.

## Estrutura

```
apps/web        Next.js (UI + BFF leve)
apps/api        NestJS (domínio, auth, RBAC, auditoria, outbox)
apps/worker     BullMQ (outbox relay, arquivos, e-mails, notificações)
packages/contracts  Zod, enums, permissões, máquinas de estado
packages/db         Prisma, migrations com RLS, seed
packages/ui         Design system
docs/               Arquitetura, ADRs, modelo de dados
```

## Ambiente local

Pré-requisitos: Node `24.19.0`, pnpm `12.3.4`, Docker.

```bash
node scripts/setup-env.mjs        # cria .env com segredos aleatórios
docker compose up --build         # ambiente completo
```

Portas no host são configuráveis no `.env` (`*_HOST_PORT`). Padrão deste repositório:

| Serviço | URL |
|---|---|
| Web | http://localhost:3020 |
| API + Swagger | http://localhost:4000/docs |
| MinIO console | http://localhost:9021 |
| Mailpit | http://localhost:8035 |

### Desenvolvimento no host (hot reload)

```bash
pnpm install --frozen-lockfile
docker compose up -d postgres redis minio minio-init mailpit
node scripts/with-host-env.mjs pnpm --filter @ordens/db migrate:deploy
SEED_DEMO=true node scripts/with-host-env.mjs node packages/db/dist/seed/run.js
node scripts/with-host-env.mjs pnpm --filter @ordens/api dev
node scripts/with-host-env.mjs pnpm --filter @ordens/worker dev
pnpm --filter @ordens/web dev
```

### Usuários de demonstração

O seed demo cria o tenant **Grão Forte Agro** e um segundo tenant para demonstrar isolamento. A senha vem de `SEED_DEMO_PASSWORD`; se vazia, é gerada e exibida **uma única vez** no log do seed (`docker compose logs migrate`).

| Usuário | Perfil |
|---|---|
| admin@graoforte.demo | Administrador Matriz |
| gestor@graoforte.demo | Gestor Matriz |
| operador@graoforte.demo | Operador Matriz |
| leitura@graoforte.demo | Somente leitura Matriz |
| fazenda.joao@graoforte.demo | Administrador Fazenda |
| fazenda.maria@graoforte.demo | Operador Fazenda |
| comprador.abc@graoforte.demo | Comprador |
| comprador.nutri@graoforte.demo | Comprador |
| admin@horizonte.demo | Administrador Matriz (outro tenant) |

## Testes

```bash
pnpm --filter @ordens/contracts test                                   # unitários de domínio
node scripts/with-host-env.mjs pnpm --filter @ordens/db test:integration   # isolamento RLS (role ordens_app)
E2E_PASSWORD=... pnpm --filter @ordens/web e2e                         # Playwright
```

## Produção

- Migrations são um **job explícito de release** (target `migrate` do Dockerfile); API e worker nunca migram no boot.
- Seed demo nunca roda com `NODE_ENV=production`.
- `SCANNER=clamav` e `COOKIE_SECURE=true` são obrigatórios (a API recusa iniciar sem eles).

Veja [docs/environments.md](docs/environments.md) e [docs/definition-of-done.md](docs/definition-of-done.md).
