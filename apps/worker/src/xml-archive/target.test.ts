import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveLocation } from '../jobs/xml-archive.js';
import { ArchiveError, createArchiveTarget, safeSegment } from './target.js';

const noCreds = { domain: null, username: null, password: null };
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('destino da cópia do XML', () => {
  it('grava em pasta local liberada, cria subpastas e não sobrescreve', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'xml-archive-'));
    dirs.push(root);
    const target = createArchiveTarget(path.join(root, 'nfe'), noCreds, [root]);
    const file = await target.put(['2026', '09'], 'chave-nfe.xml', Buffer.from('<a/>'));
    expect(await readFile(file, 'utf8')).toBe('<a/>');
    await target.put(['2026', '09'], 'chave-nfe.xml', Buffer.from('<b/>'));
    expect(await readFile(file, 'utf8')).toBe('<a/>');
    await target.remove(['2026', '09'], 'chave-nfe.xml');
    expect(await readdir(path.dirname(file))).toEqual([]);
  });

  it('recusa pasta local fora das liberadas (inclusive por prefixo parecido)', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'xml-archive-'));
    dirs.push(root);
    expect(() => createArchiveTarget(`${root}-outra`, noCreds, [root])).toThrow(ArchiveError);
    expect(() => createArchiveTarget(root, noCreds, [])).toThrow(ArchiveError);
  });

  it('caminho de rede usa smbclient fora do Windows', () => {
    const t = createArchiveTarget('\\\\srv\\xml\\nfe', noCreds, [], 'linux');
    expect(t.constructor.name).toBe('SmbTarget');
    expect(createArchiveTarget('\\\\srv\\xml', noCreds, [], 'win32').constructor.name).toBe('FsTarget');
  });

  it('limpa nomes de pasta inválidos no Windows', () => {
    expect(safeSegment('Fazenda São João: <Lote 2>. ')).toBe('Fazenda Sao Joao Lote 2');
    expect(safeSegment('***')).toBe('Sem nome');
  });

  it('organiza pelo modelo de subpastas, com a data de emissão no horário de Brasília', () => {
    const inv = { id: 'x', accessKey: '5'.repeat(44), issuedAt: new Date('2026-10-01T01:00:00Z'), createdAt: new Date(), issuerName: 'Fazenda Boa Vista', issuerDocument: '529.982.247-25', recipientDocument: '10.333.574/0001-35', fileUploadId: null, archiveAttempts: 0 };
    expect(archiveLocation(inv, String.raw`{ano}\{mes}`)).toEqual({ dirs: ['2026', '09'], name: `${'5'.repeat(44)}-nfe.xml` });
    // Padrão SAAM: ano > mês > dia > CNPJ da Matriz destinatária > tipo.
    expect(archiveLocation(inv, String.raw`{ano}\{mes}\{dia}\{cnpj_destinatario}\{tipo}`).dirs).toEqual(['2026', '09', '30', '10333574000135', 'NFE']);
    expect(archiveLocation(inv, String.raw`{cnpj_emitente}`).dirs).toEqual(['52998224725']);
    expect(archiveLocation(inv, String.raw`{fazenda}\{ano}`).dirs).toEqual(['Fazenda Boa Vista', '2026']);
    expect(archiveLocation(inv, '').dirs).toEqual([]);
  });
});
