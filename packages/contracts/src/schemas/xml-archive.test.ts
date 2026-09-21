import { describe, expect, it } from 'vitest';
import { normalizeArchivePath, normalizeFolderTemplate, renderFolderTemplate, validArchivePath, xmlArchiveSettingsSchema } from './xml-archive.js';

describe('caminho da pasta de rede', () => {
  it('normaliza barras e a barra final', () => {
    expect(normalizeArchivePath('//srv01/fiscal/xml/')).toBe('\\\\srv01\\fiscal\\xml');
    expect(normalizeArchivePath(' \\\\srv01\\fiscal\\ ')).toBe('\\\\srv01\\fiscal');
    expect(normalizeArchivePath('D:/xml/')).toBe('D:\\xml');
    expect(normalizeArchivePath('/mnt/xml/')).toBe('/mnt/xml');
  });

  it('aceita UNC, pasta Windows e pasta montada; recusa o resto', () => {
    expect(validArchivePath('\\\\srv01\\fiscal')).toBe(true);
    expect(validArchivePath('\\\\srv01.cooper.local\\Fiscal NF-e\\Fazendas')).toBe(true);
    expect(validArchivePath('D:\\xml')).toBe(true);
    expect(validArchivePath('/mnt/xml')).toBe(true);
    expect(validArchivePath('\\\\srv01')).toBe(false);
    expect(validArchivePath('\\\\srv01\\fiscal\\..\\outra')).toBe(false);
    expect(validArchivePath('xml')).toBe(false);
    expect(validArchivePath('\\\\srv01\\fis"cal')).toBe(false);
  });

  it('recusa credenciais com quebra de linha', () => {
    const base = { enabled: true, path: '\\\\srv\\xml', folderTemplate: '' };
    expect(xmlArchiveSettingsSchema.safeParse({ ...base, password: 'a\nusername = b' }).success).toBe(false);
    expect(xmlArchiveSettingsSchema.safeParse({ ...base, username: 'svc\rx' }).success).toBe(false);
    expect(xmlArchiveSettingsSchema.safeParse({ ...base, username: 'svc-ordens', password: 'x' }).success).toBe(true);
  });

  it('modelo de subpastas: normaliza, valida marcadores e preenche', () => {
    expect(normalizeFolderTemplate(String.raw` {ano}/{mes}//{dia}\{cnpj_emitente}\NFE `)).toBe(String.raw`{ano}\{mes}\{dia}\{cnpj_emitente}\NFE`);
    expect(normalizeFolderTemplate('')).toBe('');
    expect(normalizeFolderTemplate(String.raw`{ano}\{senha}`)).toBeNull();
    expect(normalizeFolderTemplate(String.raw`{ano}\..`)).toBeNull();
    expect(normalizeFolderTemplate('C:{ano}')).toBeNull();
    const values = { ano: '2026', mes: '09', dia: '01', cnpj_emitente: '10333574000135', cnpj_destinatario: '', fazenda: 'Fazenda Boa Vista', tipo: 'NFE' };
    expect(renderFolderTemplate(String.raw`{ano}\{mes}\{dia}\{cnpj_emitente}\{tipo}`, values)).toEqual(['2026', '09', '01', '10333574000135', 'NFE']);
    expect(renderFolderTemplate('{cnpj_destinatario}', values)).toEqual(['SEM-CNPJ_DESTINATARIO']);
    expect(renderFolderTemplate('', values)).toEqual([]);
  });
});
