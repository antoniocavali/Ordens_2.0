import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isNetworkPath } from '@ordens/contracts';

/** Erro de cópia com mensagem pronta para a tela (sem detalhes técnicos do servidor). */
export class ArchiveError extends Error {}

export interface ArchiveCredentials {
  domain: string | null;
  username: string | null;
  password: string | null;
}

/** Destino da cópia: grava um arquivo em subpastas relativas ao caminho configurado. */
export interface ArchiveTarget {
  /** Devolve o caminho completo gravado. */
  put(dirs: string[], name: string, data: Buffer): Promise<string>;
  remove(dirs: string[], name: string): Promise<void>;
}

const TIMEOUT_MS = 30_000;

/**
 * Caminho UNC no Windows e pastas locais/montadas: sistema de arquivos (a conta do serviço precisa
 * de acesso). Caminho UNC em Linux (containers): `smbclient`, com as credenciais configuradas.
 */
export function createArchiveTarget(base: string, creds: ArchiveCredentials, allowedLocalRoots: string[], platform = process.platform): ArchiveTarget {
  if (isNetworkPath(base)) return platform === 'win32' ? new FsTarget(base, path.win32) : new SmbTarget(base, creds);
  const p = platform === 'win32' ? path.win32 : path.posix;
  const norm = (v: string) => (platform === 'win32' ? p.normalize(v).toLowerCase() : p.normalize(v));
  const allowed = allowedLocalRoots.some((root) => {
    const r = norm(root).replace(/[\\/]+$/, '');
    const b = norm(base);
    return b === r || b.startsWith(r + p.sep);
  });
  if (!allowed) throw new ArchiveError('Pasta local não liberada neste servidor. Use um caminho de rede (\\\\servidor\\compartilhamento).');
  return new FsTarget(base, p);
}

class FsTarget implements ArchiveTarget {
  constructor(
    private readonly base: string,
    private readonly p: typeof path.win32,
  ) {}

  async put(dirs: string[], name: string, data: Buffer) {
    const dir = this.p.join(this.base, ...dirs);
    const file = this.p.join(dir, name);
    try {
      await mkdir(dir, { recursive: true });
      // Nunca sobrescreve: a mesma chave de acesso gera sempre o mesmo arquivo.
      await writeFile(file, data, { flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw fsError(err);
    }
    return file;
  }

  async remove(dirs: string[], name: string) {
    await unlink(this.p.join(this.base, ...dirs, name)).catch((err: unknown) => {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw fsError(err);
    });
  }
}

function fsError(err: unknown): ArchiveError {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'EACCES' || code === 'EPERM') return new ArchiveError('Sem permissão de gravação na pasta.');
  if (code === 'ENOENT' || code === 'ENOTDIR') return new ArchiveError('Pasta ou servidor não encontrado.');
  if (code === 'ENOSPC') return new ArchiveError('Sem espaço na pasta de destino.');
  if (code === 'ETIMEDOUT' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || code === 'UNKNOWN') return new ArchiveError('Servidor da pasta de rede inacessível.');
  return new ArchiveError(`Falha ao gravar na pasta (${code ?? 'erro desconhecido'}).`);
}

class SmbTarget implements ArchiveTarget {
  private readonly service: string;
  private readonly baseDirs: string[];

  constructor(
    base: string,
    private readonly creds: ArchiveCredentials,
  ) {
    const [host, share, ...rest] = base.slice(2).split('\\');
    this.service = `//${host}/${share}`;
    this.baseDirs = rest.filter(Boolean);
  }

  async put(dirs: string[], name: string, data: Buffer) {
    const all = [...this.baseDirs, ...dirs];
    const tmp = await mkdtemp(path.join(tmpdir(), 'ordens-smb-'));
    const local = path.join(tmp, 'file.xml');
    try {
      await writeFile(local, data, { mode: 0o600 });
      // Cria as subpastas (as já existentes só devolvem aviso) e depois grava o arquivo.
      const mkdirs = all.map((_, i) => `mkdir "${all.slice(0, i + 1).join('\\')}"`).join('; ');
      if (mkdirs) await this.run(tmp, mkdirs, true);
      await this.run(tmp, `put "${local}" "${[...all, name].join('\\')}"`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    return `\\\\${this.service.slice(2).replace('/', '\\')}\\${[...all, name].join('\\')}`;
  }

  async remove(dirs: string[], name: string) {
    const tmp = await mkdtemp(path.join(tmpdir(), 'ordens-smb-'));
    try {
      await this.run(tmp, `del "${[...this.baseDirs, ...dirs, name].join('\\')}"`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }

  /** Senha num arquivo temporário 0600 (nunca na linha de comando, visível na lista de processos). */
  private async run(tmp: string, commands: string, ignoreErrors = false) {
    const args = [this.service, '-m', 'SMB3', '-c', commands];
    if (this.creds.username) {
      const auth = path.join(tmp, 'auth');
      await writeFile(auth, `username = ${this.creds.username}\npassword = ${this.creds.password ?? ''}\n${this.creds.domain ? `domain = ${this.creds.domain}\n` : ''}`, { mode: 0o600 });
      args.push('-A', auth);
    } else {
      args.push('-N');
    }
    const { code, output } = await new Promise<{ code: number | string | null; output: string }>((resolve) => {
      execFile('smbclient', args, { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
        const code = err ? ((err as { killed?: boolean }).killed ? 'ETIMEDOUT' : ((err as NodeJS.ErrnoException).code ?? 1)) : 0;
        resolve({ code, output: `${stdout}\n${stderr}` });
      });
    });
    if (code === 'ENOENT') throw new ArchiveError('O servidor não tem o cliente de rede (smbclient) instalado.');
    const status = /NT_STATUS_[A-Z_]+/.exec(output)?.[0];
    if (ignoreErrors && (!status || status === 'NT_STATUS_OBJECT_NAME_COLLISION')) return;
    if (code === 0 && (!status || status === 'NT_STATUS_OBJECT_NAME_COLLISION')) return;
    throw smbError(status, code);
  }
}

function smbError(status: string | undefined, code: number | string | null): ArchiveError {
  switch (status) {
    case 'NT_STATUS_LOGON_FAILURE':
    case 'NT_STATUS_ACCOUNT_DISABLED':
    case 'NT_STATUS_PASSWORD_EXPIRED':
      return new ArchiveError('Usuário ou senha da rede recusados.');
    case 'NT_STATUS_ACCESS_DENIED':
      return new ArchiveError('Sem permissão de gravação na pasta.');
    case 'NT_STATUS_BAD_NETWORK_NAME':
      return new ArchiveError('Compartilhamento não encontrado no servidor.');
    case 'NT_STATUS_OBJECT_PATH_NOT_FOUND':
    case 'NT_STATUS_OBJECT_NAME_NOT_FOUND':
      return new ArchiveError('Pasta não encontrada no compartilhamento.');
    case 'NT_STATUS_DISK_FULL':
      return new ArchiveError('Sem espaço na pasta de destino.');
    case 'NT_STATUS_NOT_FOUND':
    case 'NT_STATUS_RESOURCE_NAME_NOT_FOUND':
    case 'NT_STATUS_HOST_UNREACHABLE':
    case 'NT_STATUS_CONNECTION_REFUSED':
    case 'NT_STATUS_IO_TIMEOUT':
    case 'NT_STATUS_UNSUCCESSFUL':
      return new ArchiveError('Servidor da pasta de rede inacessível.');
    default:
      if (code === 'ETIMEDOUT' || code === null) return new ArchiveError('O servidor da pasta de rede não respondeu a tempo.');
      return new ArchiveError(status ? `Falha na pasta de rede (${status}).` : 'Falha ao gravar na pasta de rede.');
  }
}

/** Remove caracteres inválidos em nomes de pasta/arquivo do Windows. */
export function safeSegment(value: string, max = 80) {
  const cleaned = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return cleaned.slice(0, max) || 'Sem nome';
}
