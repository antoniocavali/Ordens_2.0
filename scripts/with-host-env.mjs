#!/usr/bin/env node
// Executa um comando no host usando o .env, trocando hostnames de containers por localhost + portas mapeadas.
// Uso: node scripts/with-host-env.mjs <comando> [args...]
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileEnv = Object.fromEntries(
  readFileSync(resolve(root, '.env'), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1).replace(/^"(.*)"$/, '$1')];
    }),
);

const port = (k, d) => fileEnv[k] || d;
const rewrite = (v) =>
  v
    .replace('@postgres:5432', `@localhost:${port('POSTGRES_HOST_PORT', '5432')}`)
    .replace('redis://redis:6379', `redis://localhost:${port('REDIS_HOST_PORT', '6379')}`)
    .replace('http://minio:9000', `http://localhost:${port('MINIO_HOST_PORT', '9000')}`);

const env = { ...Object.fromEntries(Object.entries(fileEnv).map(([k, v]) => [k, rewrite(v)])) };
env.SMTP_HOST = 'localhost';
env.SMTP_PORT = port('MAILPIT_SMTP_HOST_PORT', '1025');
env.API_INTERNAL_URL = `http://localhost:${port('API_HOST_PORT', '4000')}`;

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
  console.error('Informe o comando a executar.');
  process.exit(2);
}
const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...env, ...process.env } });
child.on('exit', (code) => process.exit(code ?? 1));
