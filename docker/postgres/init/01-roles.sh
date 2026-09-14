#!/bin/sh
# Executado apenas na primeira inicialização do volume do PostgreSQL.
# Cria a role dona do schema (migrations) e a role de runtime da aplicação (sem BYPASSRLS).
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ordens_owner') THEN
      CREATE ROLE ordens_owner LOGIN PASSWORD '${ORDENS_OWNER_PASSWORD}' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ordens_app') THEN
      CREATE ROLE ordens_app LOGIN PASSWORD '${ORDENS_APP_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
  END
  \$\$;

  ALTER DATABASE "$POSTGRES_DB" OWNER TO ordens_owner;
  -- ordens_owner precisa de CREATEDB apenas para o shadow database do prisma migrate dev (somente dev).
  ALTER ROLE ordens_owner CREATEDB;
  ALTER SCHEMA public OWNER TO ordens_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO ordens_app;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOSQL

# Banco separado para testes de integração, com a mesma separação de roles.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  SELECT 'CREATE DATABASE ordens_test OWNER ordens_owner'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ordens_test')\gexec
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname ordens_test <<-EOSQL
  ALTER SCHEMA public OWNER TO ordens_owner;
  REVOKE ALL ON SCHEMA public FROM PUBLIC;
  GRANT USAGE ON SCHEMA public TO ordens_app;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOSQL
