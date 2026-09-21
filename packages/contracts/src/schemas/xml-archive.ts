import { z } from 'zod';

/** Marcadores do modelo de subpastas, preenchidos com os dados da nota. */
export const XML_ARCHIVE_TOKENS = {
  ano: 'Ano de emissão (2026)',
  mes: 'Mês de emissão (09)',
  dia: 'Dia de emissão (01)',
  cnpj_emitente: 'CNPJ/CPF de quem emitiu a nota (a Fazenda)',
  cnpj_destinatario: 'CNPJ do destinatário da nota (a Matriz)',
  fazenda: 'Nome de quem emitiu a nota',
  tipo: 'Tipo do documento (NFE)',
} as const;
export type XmlArchiveToken = keyof typeof XML_ARCHIVE_TOKENS;

/** Modelos prontos; o modelo pode ser editado livremente. */
export const XML_ARCHIVE_PRESETS = [
  { label: 'Ano / mês / dia / CNPJ / tipo (padrão SAAM)', template: '{ano}\\{mes}\\{dia}\\{cnpj_destinatario}\\{tipo}' },
  { label: 'Ano / mês', template: '{ano}\\{mes}' },
  { label: 'Fazenda / ano / mês', template: '{fazenda}\\{ano}\\{mes}' },
  { label: 'Tudo na mesma pasta', template: '' },
] as const;

export const DEFAULT_XML_ARCHIVE_TEMPLATE = '{ano}\\{mes}';

const TEMPLATE_SEGMENT = /^(?:[A-Za-z0-9 ._-]|\{[a-z_]+\})+$/;

/** Normaliza separadores (/ ou \) e valida marcadores e nomes de pasta. Devolve null se inválido. */
export function normalizeFolderTemplate(raw: string): string | null {
  const segments = raw
    .trim()
    .split(/[\\/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const seg of segments) {
    if (seg === '.' || seg === '..' || !TEMPLATE_SEGMENT.test(seg)) return null;
    for (const [, token] of seg.matchAll(/\{([a-z_]+)\}/g)) if (!(token! in XML_ARCHIVE_TOKENS)) return null;
  }
  return segments.join('\\');
}

/** Preenche o modelo. Valores vazios viram "SEM-..." para não gerar pasta sem nome. */
export function renderFolderTemplate(template: string, values: Record<XmlArchiveToken, string>): string[] {
  if (!template) return [];
  return template.split('\\').map((seg) => seg.replace(/\{([a-z_]+)\}/g, (_, t: XmlArchiveToken) => values[t] || `SEM-${t.toUpperCase()}`));
}

/** Tentativas automáticas por nota antes de ficar só no reenvio manual. */
export const XML_ARCHIVE_MAX_ATTEMPTS = 8;

const UNC = /^\\\\[A-Za-z0-9._-]+\\[^\\/:*?"<>|]+(\\[^\\/:*?"<>|]+)*$/;
const WINDOWS_LOCAL = /^[A-Za-z]:\\([^\\/:*?"<>|]+\\?)*$/;
const POSIX_LOCAL = /^\/([^/\0]+\/?)*$/;

/** Normaliza barras e remove a barra final: `//srv/xml/` → `\\srv\xml`. */
export function normalizeArchivePath(raw: string): string {
  const v = raw.trim();
  if (v.startsWith('//') || v.startsWith('\\\\')) return v.replace(/\//g, '\\').replace(/\\+$/, '');
  if (/^[A-Za-z]:[\\/]/.test(v)) return v.replace(/\//g, '\\').replace(/(.)\\+$/, '$1');
  return v.replace(/(.)\/+$/, '$1');
}

export function isNetworkPath(path: string) {
  return path.startsWith('\\\\');
}

export function validArchivePath(path: string) {
  if (path.split(/[\\/]/).some((seg) => seg === '..' || seg === '.')) return false;
  return UNC.test(path) || WINDOWS_LOCAL.test(path) || POSIX_LOCAL.test(path);
}

export const xmlArchiveSettingsSchema = z
  .object({
    enabled: z.boolean(),
    path: z.string().max(400).transform(normalizeArchivePath),
    domain: z.string().trim().max(100).regex(/^[^\r\n\\/]*$/, 'Domínio inválido').nullable().optional(),
    username: z.string().trim().max(100).regex(/^[^\r\n]*$/, 'Usuário inválido').nullable().optional(),
    /** Vazio/ausente mantém a senha atual; `clearPassword` apaga. */
    password: z.string().max(256).regex(/^[^\r\n]*$/, 'Senha inválida').optional(),
    clearPassword: z.boolean().optional(),
    folderTemplate: z.string().max(200),
  })
  .superRefine((v, ctx) => {
    if (v.path && !validArchivePath(v.path)) {
      ctx.addIssue({ code: 'custom', path: ['path'], message: 'Informe um caminho de rede como \\\\servidor\\compartilhamento\\pasta' });
    }
    if (normalizeFolderTemplate(v.folderTemplate) === null) {
      ctx.addIssue({ code: 'custom', path: ['folderTemplate'], message: 'Modelo inválido: use letras, números, espaço, . _ - e os marcadores da lista' });
    }
    if (v.enabled && !v.path) ctx.addIssue({ code: 'custom', path: ['path'], message: 'Informe a pasta para ativar a cópia' });
  })
  .transform((v) => ({ ...v, folderTemplate: normalizeFolderTemplate(v.folderTemplate) ?? '' }));
export type XmlArchiveSettingsInput = z.input<typeof xmlArchiveSettingsSchema>;

export interface XmlArchiveSettingsDto {
  enabled: boolean;
  path: string;
  domain: string | null;
  username: string | null;
  hasPassword: boolean;
  folderTemplate: string;
  lastTest: { at: string; ok: boolean; message: string | null } | null;
  updatedAt: string | null;
  stats: { copied: number; pending: number; failed: number; lastError: string | null };
}

/** Situação da cópia de uma nota (só a Matriz vê; o caminho é da rede interna). */
export interface InvoiceArchiveInfo {
  status: 'COPIED' | 'PENDING' | 'FAILED';
  at: string | null;
  path: string | null;
  error: string | null;
}
