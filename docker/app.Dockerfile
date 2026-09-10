# syntax=docker/dockerfile:1.7
# Dockerfile único do monorepo, com targets: dev, migrate, api, worker, web.

ARG NODE_VERSION=24.19.0

# ─── Base com pnpm fixado ───
FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true \
    HUSKY=0 \
    NEXT_TELEMETRY_DISABLED=1
RUN apk add --no-cache libc6-compat \
 && npm install -g pnpm@12.3.4 --allow-scripts=pnpm
WORKDIR /repo

# ─── Manifests (camada de cache de dependências) ───
FROM base AS manifests
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/ui/package.json packages/ui/

# ─── Todas as dependências (build e dev) ───
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ─── Somente dependências de produção ───
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ─── Código-fonte + client Prisma gerado ───
FROM deps AS source
COPY . .
RUN pnpm --filter @ordens/db generate

# ─── Desenvolvimento (hot reload via docker-compose.override.yml) ───
FROM source AS dev
ENV NODE_ENV=development \
    CHOKIDAR_USEPOLLING=true \
    WATCHPACK_POLLING=true \
    TSC_WATCHFILE=DynamicPriorityPolling
RUN pnpm --filter @ordens/contracts build && pnpm --filter @ordens/db build
CMD ["pnpm", "dev"]

# ─── Build de produção ───
FROM source AS build
ENV NODE_ENV=production
RUN pnpm turbo run build --filter=@ordens/api --filter=@ordens/worker --filter=@ordens/web

# ─── Runtime base (sem pnpm, usuário não-root) ───
FROM node:${NODE_VERSION}-alpine AS runtime
RUN apk add --no-cache libc6-compat tini
ENV NODE_ENV=production
WORKDIR /app
USER node
ENTRYPOINT ["/sbin/tini", "--"]

# ─── Migrations (job explícito de release; em dev roda também o seed) ───
FROM source AS migrate
RUN pnpm --filter @ordens/contracts build && pnpm --filter @ordens/db build \
 && chown -R node:node /repo/packages/db
USER node
WORKDIR /repo/packages/db
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/seed/run.js"]

# ─── API ───
FROM runtime AS api
COPY --from=prod-deps --chown=node:node /repo /app
COPY --from=build --chown=node:node /repo/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build --chown=node:node /repo/packages/db/dist /app/packages/db/dist
COPY --from=build --chown=node:node /repo/apps/api/dist /app/apps/api/dist
EXPOSE 4000
CMD ["node", "apps/api/dist/main.js"]

# ─── Worker ───
FROM runtime AS worker
COPY --from=prod-deps --chown=node:node /repo /app
COPY --from=build --chown=node:node /repo/packages/contracts/dist /app/packages/contracts/dist
COPY --from=build --chown=node:node /repo/packages/db/dist /app/packages/db/dist
COPY --from=build --chown=node:node /repo/apps/worker/dist /app/apps/worker/dist
CMD ["node", "apps/worker/dist/main.js"]

# ─── Web (Next.js standalone) ───
FROM runtime AS web
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone /app
COPY --from=build --chown=node:node /repo/apps/web/.next/static /app/apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public /app/apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
