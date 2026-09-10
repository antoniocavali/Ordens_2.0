import { createConnection } from 'node:net';
import type { Readable } from 'node:stream';

export type ScanResult = { status: 'CLEAN' } | { status: 'INFECTED'; signature: string } | { status: 'SKIPPED_DEV' };

export interface Scanner {
  scan(stream: Readable): Promise<ScanResult>;
}

/** Somente desenvolvimento: não verifica nada e marca explicitamente o registro. */
export class NoopScanner implements Scanner {
  async scan(stream: Readable): Promise<ScanResult> {
    stream.resume();
    return { status: 'SKIPPED_DEV' };
  }
}

/** Cliente mínimo do protocolo clamd INSTREAM. */
export class ClamAvScanner implements Scanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 120_000,
  ) {}

  scan(stream: Readable): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      let response = '';
      socket.setTimeout(this.timeoutMs, () => socket.destroy(new Error('Timeout do ClamAV')));
      socket.on('error', reject);
      socket.on('data', (d) => (response += d.toString()));
      socket.on('end', () => {
        const text = response.replace(/\0/g, '').trim();
        if (text.endsWith('OK')) resolve({ status: 'CLEAN' });
        else if (text.includes('FOUND')) resolve({ status: 'INFECTED', signature: text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') });
        else reject(new Error(`Resposta inesperada do ClamAV: ${text}`));
      });
      socket.on('connect', () => {
        socket.write('zINSTREAM\0');
        stream.on('data', (chunk: Buffer) => {
          const size = Buffer.alloc(4);
          size.writeUInt32BE(chunk.length, 0);
          if (!socket.write(Buffer.concat([size, chunk]))) {
            stream.pause();
            socket.once('drain', () => stream.resume());
          }
        });
        stream.on('end', () => socket.write(Buffer.alloc(4)));
        stream.on('error', (err) => socket.destroy(err));
      });
    });
  }
}
