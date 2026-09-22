import { createDecipheriv, createHash } from 'node:crypto';
import type { Job } from 'bullmq';
import type { WorkerContext } from '../context.js';
import { createMailer } from '../mail/mailer.js';
import type { OutboxJob } from '../queues.js';
import type { NotificationEmailPayload } from './notifications.js';

function decryptToken(secret: string, payloadB64: string): string {
  const key = createHash('sha256').update(`outbox:${secret}`).digest();
  const buf = Buffer.from(payloadB64, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const AUTH_FOOTER = 'Se você não reconhece esta solicitação, ignore este e-mail.';
const NOTIFICATION_FOOTER = 'Você recebe este e-mail porque ativou este aviso. Para deixar de receber, acesse Preferências &gt; Notificações por e-mail.';

function layout(title: string, body: string, cta: { label: string; url: string } | null, footer = AUTH_FOOTER) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F5F5F8;font-family:Inter,Segoe UI,Arial,sans-serif;color:#15131F">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
  <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;padding:32px">
  <tr><td style="font-size:13px;font-weight:600;color:#6D28D9;letter-spacing:.08em">COOPERFARMS · ORDENS</td></tr>
  <tr><td style="padding-top:16px;font-size:22px;font-weight:600">${escapeHtml(title)}</td></tr>
  <tr><td style="padding-top:12px;font-size:14px;line-height:22px;color:#5F5B73">${body}</td></tr>
  ${cta ? `<tr><td style="padding-top:24px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#6D28D9;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600;font-size:14px">${escapeHtml(cta.label)}</a></td></tr>` : ''}
  <tr><td style="padding-top:24px;font-size:12px;color:#8A86A0">${footer}</td></tr>
  </table></td></tr></table></body></html>`;
}

export function emailHandler(ctx: WorkerContext) {
  const mailer = createMailer(ctx.env);
  ctx.logger.info({ transport: mailer.kind }, 'Envio de e-mail configurado');

  return async (job: Job<OutboxJob>) => {
    if (job.data.type === 'notification.email') {
      const n = job.data.payload as unknown as NotificationEmailPayload;
      await mailer.send({
        to: n.email,
        subject: n.title,
        text: [`Olá, ${n.name}.`, n.title, n.body, n.url ? `Abrir: ${n.url}` : null].filter(Boolean).join('\n\n'),
        html: layout(
          n.title,
          `Olá, ${escapeHtml(n.name.split(' ')[0] ?? n.name)}.${n.body ? `<br><br>${escapeHtml(n.body)}` : ''}`,
          n.url ? { label: 'Abrir no sistema', url: n.url } : null,
          NOTIFICATION_FOOTER,
        ),
      });
      ctx.logger.info({ type: job.data.type, eventId: job.data.eventId }, 'E-mail de aviso enviado');
      return;
    }

    const p = job.data.payload as { email: string; name: string; tokenEnc: string; organization?: string };
    const token = decryptToken(ctx.env.SESSION_SECRET, p.tokenEnc);
    const firstName = escapeHtml(p.name.split(' ')[0] ?? p.name);

    if (job.data.type === 'auth.password_reset_requested') {
      const url = `${ctx.env.WEB_ORIGIN}/redefinir-senha?token=${encodeURIComponent(token)}`;
      await mailer.send({
        to: p.email,
        subject: 'Redefinição de senha — Ordens',
        text: `Olá, ${p.name}. Para redefinir sua senha acesse: ${url} (válido por 30 minutos).`,
        html: layout('Redefinir senha', `Olá, ${firstName}. Recebemos um pedido para redefinir sua senha. O link é válido por 30 minutos.`, {
          label: 'Criar nova senha',
          url,
        }),
      });
    } else if (job.data.type === 'user.invited') {
      const url = `${ctx.env.WEB_ORIGIN}/redefinir-senha?token=${encodeURIComponent(token)}&convite=1`;
      await mailer.send({
        to: p.email,
        subject: `Convite para ${p.organization ?? 'Ordens'}`,
        text: `Olá, ${p.name}. Você foi convidado para ${p.organization}. Defina sua senha: ${url} (válido por 72 horas).`,
        html: layout(
          'Você foi convidado',
          `Olá, ${firstName}. Você recebeu acesso à organização <strong>${escapeHtml(p.organization ?? '')}</strong>. Defina sua senha para começar. O link é válido por 72 horas.`,
          { label: 'Definir senha', url },
        ),
      });
    }
    ctx.logger.info({ type: job.data.type, eventId: job.data.eventId }, 'E-mail enviado');
  };
}
