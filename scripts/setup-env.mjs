#!/usr/bin/env node
// Cria .env a partir de .env.example substituindo senhas "change-me-*" e segredos vazios por valores aleatórios.
// Uso: node scripts/setup-env.mjs [--force]
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = resolve(root, '.env');
if (existsSync(target) && !process.argv.includes('--force')) {
  console.log('.env já existe (use --force para recriar).');
  process.exit(0);
}

const secrets = new Map();
const secretFor = (placeholder) => {
  if (!secrets.has(placeholder)) secrets.set(placeholder, randomBytes(18).toString('base64url'));
  return secrets.get(placeholder);
};

let content = readFileSync(resolve(root, '.env.example'), 'utf8');
content = content.replace(/change-me-[a-z-]+/g, (m) => secretFor(m));
content = content.replace(/^(SESSION_SECRET|TWO_FACTOR_ENC_KEY)=$/gm, (_, k) => `${k}=${randomBytes(32).toString('base64')}`);

writeFileSync(target, content, { mode: 0o600 });
console.log('.env criado com segredos aleatórios.');
