import { UnrecoverableError } from 'bullmq';
import nodemailer, { type Transporter } from 'nodemailer';
import type { WorkerEnv } from '../env.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  readonly kind: 'smtp' | 'graph';
  send(message: MailMessage): Promise<void>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const REQUEST_TIMEOUT_MS = 20_000;
/** Renova o token um pouco antes de vencer. */
const TOKEN_SAFETY_MS = 5 * 60_000;

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  /** Caixa de onde os e-mails saem (a mesma autorizada no Exchange Online). */
  sender: string;
  authorityUrl: string;
  apiUrl: string;
}

/**
 * Envio pela Microsoft Graph (`POST /users/{caixa}/sendMail`) com aplicativo do Entra ID
 * (fluxo client credentials). Sem SMTP e sem senha de usuário: o acesso é limitado a uma caixa
 * pelo RBAC para Aplicativos do Exchange Online.
 */
export class GraphMailer implements Mailer {
  readonly kind = 'graph' as const;
  private token: { value: string; expiresAt: number } | null = null;
  private pending: Promise<string> | null = null;

  constructor(
    private readonly cfg: GraphConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async send(message: MailMessage): Promise<void> {
    let response = await this.post(message, await this.accessToken());
    if (response.status === 401) {
      // Token recusado (revogado ou relógio): pega outro e tenta uma vez.
      this.token = null;
      response = await this.post(message, await this.accessToken());
    }
    if (response.status === 202 || response.status === 200) return;
    throw await this.failure(response);
  }

  private post(message: MailMessage, token: string): Promise<Response> {
    const url = `${this.cfg.apiUrl}/v1.0/users/${encodeURIComponent(this.cfg.sender)}/sendMail`;
    return this.fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: message.subject,
          body: { contentType: 'HTML', content: message.html },
          toRecipients: [{ emailAddress: { address: message.to } }],
        },
        // Não guarda cópia na caixa de enviados: são avisos automáticos.
        saveToSentItems: false,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  /** Token em cache; chamadas simultâneas compartilham a mesma requisição. */
  private accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return Promise.resolve(this.token.value);
    this.pending ??= this.requestToken().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async requestToken(): Promise<string> {
    const response = await this.fetchImpl(`${this.cfg.authorityUrl}/${encodeURIComponent(this.cfg.tenantId)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        scope: `${this.cfg.apiUrl}/.default`,
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !body.access_token) {
      const detail = `${body.error ?? response.status}: ${(body.error_description ?? '').split('\r\n')[0]}`;
      // Credencial inválida/expirada não se resolve tentando de novo.
      const Ctor = response.status === 400 || response.status === 401 ? UnrecoverableError : Error;
      throw new Ctor(`Microsoft Entra recusou o token do aplicativo (${detail}). Confira GRAPH_TENANT_ID, GRAPH_CLIENT_ID e se o segredo não expirou.`);
    }
    this.token = { value: body.access_token, expiresAt: this.now() + (body.expires_in ?? 3600) * 1000 - TOKEN_SAFETY_MS };
    return body.access_token;
  }

  private async failure(response: Response): Promise<Error> {
    const body = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    const detail = `${response.status} ${body.error?.code ?? ''} ${body.error?.message ?? ''}`.trim();
    if (response.status === 403) {
      // Pode ser propagação (30 min a 2 h) ou permissão/escopo mal configurados: tenta de novo.
      return new Error(
        `Graph recusou o envio (${detail}). Confira no Exchange Online: Test-ServicePrincipalAuthorization e se a caixa ${this.cfg.sender} está no escopo. Mudanças levam de 30 min a 2 h para valer.`,
      );
    }
    // 400/404: destinatário ou remetente inválido; repetir não adianta.
    if (response.status === 400 || response.status === 404) return new UnrecoverableError(`Graph rejeitou a mensagem (${detail})`);
    // 429/5xx e o restante: a fila tenta de novo com espera crescente.
    return new Error(`Falha temporária no envio pela Graph (${detail})`);
  }
}

export class SmtpMailer implements Mailer {
  readonly kind = 'smtp' as const;
  private readonly transport: Transporter;

  constructor(
    env: Pick<WorkerEnv, 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'SMTP_SECURE' | 'SMTP_REQUIRE_TLS' | 'MAIL_FROM'>,
    private readonly from = env.MAIL_FROM,
  ) {
    this.transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: env.SMTP_REQUIRE_TLS,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}

export function createMailer(env: WorkerEnv): Mailer {
  if (env.MAIL_TRANSPORT === 'graph') {
    return new GraphMailer({
      tenantId: env.GRAPH_TENANT_ID!,
      clientId: env.GRAPH_CLIENT_ID!,
      clientSecret: env.GRAPH_CLIENT_SECRET!,
      sender: env.GRAPH_SENDER!,
      authorityUrl: env.GRAPH_AUTHORITY_URL,
      apiUrl: env.GRAPH_API_URL,
    });
  }
  return new SmtpMailer(env);
}
