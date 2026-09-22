import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { GraphMailer, type GraphConfig } from './mailer.js';

const cfg: GraphConfig = {
  tenantId: '11111111-2222-3333-4444-555555555555',
  clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  clientSecret: 'segredo-do-app',
  sender: 'nao-responda@cooperfarms.digital',
  authorityUrl: 'https://login.microsoftonline.com',
  apiUrl: 'https://graph.microsoft.com',
};
const message = { to: 'pessoa@exemplo.com.br', subject: 'Aviso', text: 'texto', html: '<p>olá</p>' };

type Call = { url: string; init: RequestInit };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const tokenOk = (expiresIn = 3600, value = 'token-1') => json(200, { access_token: value, expires_in: expiresIn, token_type: 'Bearer' });

/** fetch falso: responde na ordem e registra as chamadas. */
function fakeFetch(...responses: (Response | (() => Response))[]) {
  const calls: Call[] = [];
  const impl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = responses[calls.length - 1] ?? json(500, {});
    return typeof next === 'function' ? next() : next;
  };
  return { calls, impl };
}
const isToken = (c: Call) => c.url.includes('/oauth2/v2.0/token');
const isSend = (c: Call) => c.url.includes('/sendMail');

describe('envio pela Microsoft Graph', () => {
  it('pede o token do aplicativo e envia pela caixa configurada', async () => {
    const { calls, impl } = fakeFetch(tokenOk(), json(202, {}));
    await new GraphMailer(cfg, impl).send(message);

    expect(calls[0]!.url).toBe(`https://login.microsoftonline.com/${cfg.tenantId}/oauth2/v2.0/token`);
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(Object.fromEntries(form)).toEqual({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    expect(calls[1]!.url).toBe('https://graph.microsoft.com/v1.0/users/nao-responda%40cooperfarms.digital/sendMail');
    expect((calls[1]!.init.headers as Record<string, string>).authorization).toBe('Bearer token-1');
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      message: { subject: 'Aviso', body: { contentType: 'HTML', content: '<p>olá</p>' }, toRecipients: [{ emailAddress: { address: 'pessoa@exemplo.com.br' } }] },
      saveToSentItems: false,
    });
  });

  it('reaproveita o token e faz uma única requisição mesmo com envios simultâneos', async () => {
    const { calls, impl } = fakeFetch(tokenOk(), json(202, {}), json(202, {}), json(202, {}));
    const mailer = new GraphMailer(cfg, impl);
    await Promise.all([mailer.send(message), mailer.send(message), mailer.send(message)]);
    expect(calls.filter(isToken)).toHaveLength(1);
    expect(calls.filter(isSend)).toHaveLength(3);
  });

  it('renova o token quando está perto de vencer', async () => {
    let now = 1_000_000;
    const { calls, impl } = fakeFetch(tokenOk(3600, 'a'), json(202, {}), tokenOk(3600, 'b'), json(202, {}));
    const mailer = new GraphMailer(cfg, impl, () => now);
    await mailer.send(message);
    now += 3600_000 - 60_000; // falta 1 min: dentro da margem de segurança
    await mailer.send(message);
    expect(calls.filter(isToken)).toHaveLength(2);
    expect((calls[3]!.init.headers as Record<string, string>).authorization).toBe('Bearer b');
  });

  it('token recusado (401): pede outro e tenta uma vez', async () => {
    const { calls, impl } = fakeFetch(tokenOk(3600, 'velho'), json(401, {}), tokenOk(3600, 'novo'), json(202, {}));
    await new GraphMailer(cfg, impl).send(message);
    expect(calls.map((c) => (isToken(c) ? 'token' : 'send'))).toEqual(['token', 'send', 'token', 'send']);
    expect((calls[3]!.init.headers as Record<string, string>).authorization).toBe('Bearer novo');
  });

  it('segredo inválido: erro claro, sem repetir e sem vazar o segredo', async () => {
    const { impl } = fakeFetch(json(401, { error: 'invalid_client', error_description: 'AADSTS7000215: Invalid client secret provided.\r\nTrace ID: x' }));
    const err = await new GraphMailer(cfg, impl).send(message).catch((e: Error) => e);
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as Error).message).toContain('AADSTS7000215');
    expect((err as Error).message).not.toContain(cfg.clientSecret);
    expect((err as Error).message).not.toContain('Trace ID');
  });

  it('classifica as falhas do envio: 403 e 429 tentam de novo; 400 e 404 não', async () => {
    const run = async (status: number, body: unknown = {}) => {
      const { impl } = fakeFetch(tokenOk(), json(status, body));
      return (await new GraphMailer(cfg, impl).send(message).catch((e: Error) => e)) as Error;
    };
    const denied = await run(403, { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } });
    expect(denied).not.toBeInstanceOf(UnrecoverableError);
    expect(denied.message).toMatch(/ErrorAccessDenied[\s\S]*Test-ServicePrincipalAuthorization[\s\S]*nao-responda@cooperfarms\.digital/);

    expect(await run(429, { error: { code: 'ApplicationThrottled' } })).not.toBeInstanceOf(UnrecoverableError);
    expect(await run(503)).not.toBeInstanceOf(UnrecoverableError);
    expect(await run(400, { error: { code: 'ErrorInvalidRecipients' } })).toBeInstanceOf(UnrecoverableError);
    expect(await run(404, { error: { code: 'ErrorInvalidUser' } })).toBeInstanceOf(UnrecoverableError);
  });
});
