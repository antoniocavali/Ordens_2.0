import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'minio',
  S3_SECRET_KEY: 'minio-secret',
  S3_BUCKET_QUARANTINE: 'quarantine',
  S3_BUCKET_DOCUMENTS: 'documents',
  SESSION_SECRET: 'x',
  TWO_FACTOR_ENC_KEY: 'x',
  WEB_ORIGIN: 'http://localhost:3020',
};
const graph = {
  MAIL_TRANSPORT: 'graph',
  GRAPH_TENANT_ID: '11111111-2222-3333-4444-555555555555',
  GRAPH_CLIENT_ID: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  GRAPH_CLIENT_SECRET: 'segredo',
  GRAPH_SENDER: 'nao-responda@cooperfarms.digital',
};

describe('configuração do envio de e-mail', () => {
  it('o padrão é SMTP (Mailpit em desenvolvimento) e ignora variáveis da Graph vazias', () => {
    const env = loadEnv({ ...base, GRAPH_TENANT_ID: '', GRAPH_CLIENT_SECRET: '' });
    expect(env.MAIL_TRANSPORT).toBe('smtp');
    expect(env.GRAPH_TENANT_ID).toBeUndefined();
  });

  it('com Graph, aceita a configuração completa', () => {
    const env = loadEnv({ ...base, ...graph });
    expect(env.GRAPH_SENDER).toBe('nao-responda@cooperfarms.digital');
    expect(env.GRAPH_API_URL).toBe('https://graph.microsoft.com');
  });

  it('com Graph, exige as quatro variáveis, GUIDs válidos e um e-mail de remetente', () => {
    expect(() => loadEnv({ ...base, MAIL_TRANSPORT: 'graph' })).toThrow(/GRAPH_TENANT_ID[\s\S]*GRAPH_CLIENT_SECRET/);
    expect(() => loadEnv({ ...base, ...graph, GRAPH_TENANT_ID: 'cooperfarms.onmicrosoft.com' })).toThrow(/GUID/);
    expect(() => loadEnv({ ...base, ...graph, GRAPH_CLIENT_ID: 'abc' })).toThrow(/GUID/);
    expect(() => loadEnv({ ...base, ...graph, GRAPH_SENDER: 'sem-arroba' })).toThrow(/e-mail/);
  });

  it('rejeita transporte desconhecido', () => {
    expect(() => loadEnv({ ...base, MAIL_TRANSPORT: 'sendgrid' })).toThrow(/MAIL_TRANSPORT/);
  });
});
