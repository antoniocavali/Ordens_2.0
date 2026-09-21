import { createServer } from 'node:http';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { createContext } from './context.js';
import { loadEnv } from './env.js';
import { emailHandler } from './jobs/email.js';
import { fileProcessingHandler } from './jobs/file-processing.js';
import { invoiceProcessingHandler } from './jobs/invoice-processing.js';
import { maintenanceHandler } from './jobs/maintenance.js';
import { notificationsHandler } from './jobs/notifications.js';
import { reportExportHandler } from './jobs/report-export.js';
import { xmlArchiveHandler } from './jobs/xml-archive.js';
import { realtimeHandler } from './jobs/realtime.js';
import { OutboxRelay } from './outbox-relay.js';
import { DEFAULT_JOB_OPTIONS, QUEUE } from './queues.js';

async function main() {
  const env = loadEnv();
  const ctx = createContext(env);
  const connection = ctx.redisConnection;
  const deadLetter = new Queue(QUEUE.DEAD_LETTER, { connection });
  const emailQueue = new Queue(QUEUE.EMAIL, { connection });
  // Publicador do canal de tempo real (SSE na API). Falhas de publicação fazem o job tentar de novo.
  const publisher = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });

  const workers = [
    new Worker(QUEUE.REALTIME, realtimeHandler(ctx, publisher), { connection, concurrency: 10 }),
    new Worker(QUEUE.FILE_PROCESSING, fileProcessingHandler(ctx), { connection, concurrency: 4 }),
    new Worker(QUEUE.INVOICES, invoiceProcessingHandler(ctx), { connection, concurrency: 4 }),
    new Worker(QUEUE.EMAIL, emailHandler(ctx), { connection, concurrency: 5 }),
    new Worker(QUEUE.NOTIFICATIONS, notificationsHandler(ctx, publisher, emailQueue), { connection, concurrency: 10 }),
    new Worker(QUEUE.MAINTENANCE, maintenanceHandler(ctx, publisher), { connection, concurrency: 1 }),
    // Relatórios grandes: poucos por vez para não disputar memória e conexões com o resto do worker.
    new Worker(QUEUE.EXPORTS, reportExportHandler(ctx), { connection, concurrency: 2 }),
    // Uma cópia por vez: evita disputar o mesmo compartilhamento e mantém a ordem das tentativas.
    new Worker(QUEUE.XML_ARCHIVE, xmlArchiveHandler(ctx), { connection, concurrency: 1 }),
  ];

  for (const w of workers) {
    w.on('failed', async (job: Job | undefined, err) => {
      ctx.logger.error({ err, queue: w.name, jobId: job?.id, attempts: job?.attemptsMade }, 'Job falhou');
      if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
        await deadLetter.add(`${w.name}:${job.name}`, { queue: w.name, data: job.data, error: err.message }, { removeOnComplete: false });
      }
    });
  }

  const maintenance = new Queue(QUEUE.MAINTENANCE, { connection });
  await maintenance.upsertJobScheduler('expire-uploads', { every: 60 * 60_000 }, { name: 'expire-uploads', opts: DEFAULT_JOB_OPTIONS });
  // SLA de 1ª resposta do atendimento (Q30): verificação a cada 5 minutos.
  // Retoma cópias de XML pendentes (pasta de rede fora do ar, por exemplo) a cada 15 minutos.
  const xmlArchive = new Queue(QUEUE.XML_ARCHIVE, { connection });
  await xmlArchive.upsertJobScheduler('xml-archive-sweep', { every: 15 * 60_000 }, { name: 'xml-archive-sweep', opts: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } });
  await maintenance.upsertJobScheduler('support-sla', { every: 5 * 60_000 }, { name: 'support-sla', opts: { ...DEFAULT_JOB_OPTIONS, attempts: 1 } });

  const relay = new OutboxRelay(ctx);
  relay.start();

  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 1, lazyConnect: true });
  await redis.connect();
  const health = createServer(async (req, res) => {
    if (req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    const checks = await Promise.allSettled([ctx.db.ping(), redis.ping()]);
    const ok = checks.every((c) => c.status === 'fulfilled');
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' }).end(JSON.stringify({ status: ok ? 'ok' : 'degraded' }));
  });
  health.listen(env.WORKER_HEALTH_PORT, '0.0.0.0');
  ctx.logger.info({ port: env.WORKER_HEALTH_PORT, scanner: env.SCANNER }, 'Worker iniciado');

  const shutdown = async (signal: string) => {
    ctx.logger.info({ signal }, 'Encerrando worker');
    health.close();
    await relay.stop();
    await Promise.allSettled([...workers.map((w) => w.close()), maintenance.close(), deadLetter.close()]);
    await Promise.allSettled([ctx.db.disconnect(), redis.quit(), publisher.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Falha ao iniciar o worker', err);
  process.exit(1);
});
