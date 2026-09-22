import { loadEnv } from '../env.js';
import { createMailer } from '../mail/mailer.js';

/**
 * Envia um e-mail de teste com a configuração atual (SMTP ou Graph). Uso na primeira subida e depois de
 * trocar o segredo do aplicativo:
 *
 *   docker compose -f docker-compose.prod.yml --env-file .env.production run --rm worker \
 *     node apps/worker/dist/tools/send-test-mail.js destinatario@cooperfarms.digital
 */
async function main() {
  const to = process.argv[2];
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    console.error('Uso: send-test-mail.js destinatario@dominio');
    process.exit(2);
  }
  const env = loadEnv();
  const mailer = createMailer(env);
  const sentAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  process.stdout.write(`Enviando pelo transporte "${mailer.kind}"${mailer.kind === 'graph' ? ` (caixa ${env.GRAPH_SENDER})` : ` (${env.SMTP_HOST}:${env.SMTP_PORT})`}…\n`);
  await mailer.send({
    to,
    subject: 'Teste de e-mail — Ordens',
    text: `Se você recebeu esta mensagem, o envio de e-mails do Ordens está funcionando. Enviado em ${sentAt}.`,
    html: `<p>Se você recebeu esta mensagem, o envio de e-mails do <strong>Ordens</strong> está funcionando.</p><p style="color:#8A86A0;font-size:12px">Enviado em ${sentAt}.</p>`,
  });
  process.stdout.write(`E-mail de teste aceito para envio a ${to}. Confira a caixa de entrada (e o spam).\n`);
}

main().catch((err: unknown) => {
  console.error('Falha no envio:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
