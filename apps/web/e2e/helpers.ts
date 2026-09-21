import { expect, type Browser, type Page } from '@playwright/test';

/** Senha do seed demo (gerada no CI, nunca fixa no repositório). */
export const password = process.env.E2E_PASSWORD ?? '';

/**
 * Envia o formulário de login. A API limita tentativas por IP (20/min) e toda a suíte roda do mesmo IP:
 * em 429 espera o Retry-After e tenta de novo, sem afrouxar o limite de produção.
 */
export async function submitLogin(page: Page, email: string, secret: string, expectedUrl: string | RegExp) {
  for (let attempt = 1; ; attempt++) {
    await page.goto('/login');
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Senha', { exact: true }).fill(secret);
    const responsePromise = page.waitForResponse((r) => r.url().includes('/api/auth/login') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    const response = await responsePromise;
    // 500 (proxy do Next sem API) e 502-504: API reiniciando (watch em dev, subida no CI).
    const transient = [500, 502, 503, 504].includes(response.status());
    if ((response.status() === 429 || transient) && attempt < 4) {
      const headers = response.headers();
      const wait = transient ? 3 : Number(headers['retry-after'] ?? headers['retry-after-default'] ?? 30);
      await page.waitForTimeout((Number.isFinite(wait) && wait > 0 ? wait : 30) * 1000 + 500);
      continue;
    }
    await expect(page).toHaveURL(expectedUrl);
    return;
  }
}

export async function login(page: Page, email: string) {
  await submitLogin(page, email, password, '/');
}

/** Abre um contexto isolado (cookies próprios) já autenticado. */
export async function loginAs(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, email);
  return { context, page };
}

export interface ApiResult<T = any> {
  status: number;
  json: T;
}

/** Chamada à API pela mesma origem, com a sessão e o CSRF da página (preparo de dados e checagens de isolamento). */
export async function api<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const csrf = document.cookie.match(/ordens_csrf=([^;]+)/)?.[1] ?? '';
      const r = await fetch(`/api${path}`, {
        method,
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let json: unknown = text;
      try {
        json = JSON.parse(text);
      } catch {
        /* resposta sem JSON */
      }
      return { status: r.status, json: json as any };
    },
    { method, path, body },
  );
}

export async function apiOk<T = any>(page: Page, method: string, path: string, body?: unknown): Promise<T> {
  const r = await api<T>(page, method, path, body);
  expect(r.status, `${method} ${path} → ${JSON.stringify(r.json)}`).toBeLessThan(300);
  return r.json;
}

/** Chave de NF-e (44 dígitos) com dígito verificador módulo 11. */
export function nfeKey(issuerDoc: string, date = new Date()) {
  const yymm = `${String(date.getFullYear()).slice(2)}${String(date.getMonth() + 1).padStart(2, '0')}`;
  const nnf = String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const code = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const base = `51${yymm}${issuerDoc.padStart(14, '0')}55001${nnf}1${code}`;
  let weight = 2;
  let sum = 0;
  for (let i = base.length - 1; i >= 0; i--) {
    sum += Number(base[i]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const rest = sum % 11;
  return `${base}${rest < 2 ? 0 : 11 - rest}`;
}

export function nfeXml({ key, issuerDoc, plate, netKg }: { key: string; issuerDoc: string; plate: string; netKg: number }) {
  const tag = issuerDoc.length === 11 ? 'CPF' : 'CNPJ';
  return `<?xml version="1.0" encoding="UTF-8"?><nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${key}" versao="4.00">
<ide><serie>1</serie><nNF>${Number(key.slice(25, 34))}</nNF><dhEmi>${new Date().toISOString()}</dhEmi></ide>
<emit><${tag}>${issuerDoc}</${tag}><xNome>Produtor</xNome></emit>
<det nItem="1"><prod><xProd>MILHO EM GRAOS</xProd><uCom>KG</uCom><qCom>${netKg}</qCom></prod></det>
<total><ICMSTot><vNF>12345.67</vNF></ICMSTot></total>
<transp><veicTransp><placa>${plate}</placa></veicTransp><vol><pesoL>${netKg}</pesoL><pesoB>${netKg + 100}</pesoB></vol></transp>
</infNFe></NFe><protNFe><infProt><chNFe>${key}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`;
}
