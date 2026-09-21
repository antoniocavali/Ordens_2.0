'use client';

import {
  DEFAULT_XML_ARCHIVE_TEMPLATE,
  normalizeFolderTemplate,
  renderFolderTemplate,
  XML_ARCHIVE_PRESETS,
  XML_ARCHIVE_TOKENS,
  type XmlArchiveSettingsDto,
  type XmlArchiveSettingsInput,
  type XmlArchiveToken,
} from '@ordens/contracts';
import { Badge, Button, Card, cn, EmptyState, Field, Input, Skeleton } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FolderSync, Loader2, PlugZap, RefreshCw, ShieldOff, SlidersHorizontal, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ApiRequestError, get, post, put } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';
import { Switch } from './workflow-page';

const KEY = ['settings', 'xml-archive'];

/** Valores de exemplo para a prévia do caminho final. */
const SAMPLE: Record<XmlArchiveToken, string> = {
  ano: '2026',
  mes: '09',
  dia: '01',
  cnpj_emitente: '52998224725',
  cnpj_destinatario: '10333574000135',
  fazenda: 'Fazenda Boa Vista',
  tipo: 'NFE',
};

/** Parâmetros do sistema: por enquanto, a cópia do XML da Fazenda em pasta de rede. */
export function ParametersPage() {
  const can = useCan();
  const { data: me } = useMe();
  const allowed = can('settings.manage');

  if (me && !allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<ShieldOff />} title="Sem acesso aos parâmetros" description="Somente administradores da Matriz alteram os parâmetros do sistema." />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3.5">
        <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
          <SlidersHorizontal className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Parâmetros</h1>
          <p className="text-sm text-muted">Integrações e ajustes gerais da empresa. Alterações ficam na auditoria.</p>
        </div>
      </div>
      {allowed ? <XmlArchiveCard /> : <Skeleton className="h-72" />}
    </div>
  );
}

function XmlArchiveCard() {
  const qc = useQueryClient();
  const [testing, setTesting] = useState(false);
  const settings = useQuery({
    queryKey: KEY,
    queryFn: () => get<XmlArchiveSettingsDto>('/settings/xml-archive'),
    // Enquanto o teste roda no servidor, atualiza até o resultado chegar.
    refetchInterval: (q) => (testing && !q.state.data?.lastTest ? 1500 : false),
  });
  const data = settings.data;

  const [enabled, setEnabled] = useState(false);
  const [path, setPath] = useState('');
  const [domain, setDomain] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [template, setTemplate] = useState(DEFAULT_XML_ARCHIVE_TEMPLATE);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setPath(data.path);
    setDomain(data.domain ?? '');
    setUsername(data.username ?? '');
    setTemplate(data.folderTemplate);
  }, [data]);

  useEffect(() => {
    if (!testing || !data?.lastTest) return;
    setTesting(false);
    if (data.lastTest.ok) toast.success('Pasta acessível', { description: data.lastTest.message ?? undefined });
    else toast.error('Não foi possível gravar na pasta', { description: data.lastTest.message ?? undefined });
  }, [testing, data?.lastTest]);

  const save = useMutation({
    mutationFn: (body: XmlArchiveSettingsInput) => put<XmlArchiveSettingsDto>('/settings/xml-archive', body),
    onSuccess: (d) => {
      qc.setQueryData(KEY, d);
      setPassword('');
      toast.success('Parâmetros salvos');
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? (err.fieldErrors.path?.[0] ?? err.message) : 'Não foi possível salvar.'),
  });

  const test = useMutation({
    mutationFn: () => post('/settings/xml-archive/test'),
    onSuccess: () => {
      qc.setQueryData<XmlArchiveSettingsDto>(KEY, (d) => (d ? { ...d, lastTest: null } : d));
      setTesting(true);
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível testar.'),
  });

  const retry = useMutation({
    mutationFn: () => post<{ pending: number }>('/settings/xml-archive/retry'),
    onSuccess: (r) => {
      toast.success(r.pending ? `${r.pending.toLocaleString('pt-BR')} XML na fila de cópia` : 'Nada pendente para copiar');
      setTimeout(() => void qc.invalidateQueries({ queryKey: KEY }), 3000);
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível reenviar.'),
  });

  if (!data) return <Skeleton className="h-72" />;

  const dirty =
    enabled !== data.enabled ||
    path.trim() !== data.path ||
    domain.trim() !== (data.domain ?? '') ||
    username.trim() !== (data.username ?? '') ||
    normalizeFolderTemplate(template) !== data.folderTemplate ||
    Boolean(password);
  const isNetwork = path.trim().startsWith('\\\\') || path.trim().startsWith('//');
  const normalized = normalizeFolderTemplate(template);
  const templateOk = normalized !== null;
  const base = (path.trim() || '\\\\servidor\\pasta').replace(/\//g, '\\').replace(/\\+$/, '');
  const preview = templateOk ? [base, ...renderFolderTemplate(normalized, SAMPLE), '29260952998224725000550010000012341000012345-nfe.xml'].join('\\') : '—';

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex gap-3">
          <FolderSync className="mt-0.5 size-5 shrink-0 text-primary" />
          <div>
            <h2 className="font-semibold">Cópia do XML da Fazenda em pasta de rede</h2>
            <p className="text-sm text-muted">
              Cada XML de NF-e enviado pela Fazenda e aceito (válido ou com divergência) é copiado para a pasta abaixo. O endereço pode ser trocado a qualquer momento: o que ainda não foi
              copiado vai para a pasta nova; o que já foi copiado continua onde está.
            </p>
          </div>
        </div>
        <Switch label="Copiar XML da Fazenda para a pasta de rede" checked={enabled} onChange={setEnabled} />
      </div>

      <form
        className="grid gap-4 border-t border-border/70 p-5 sm:grid-cols-2"
        aria-label="Pasta de rede"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ enabled, path, domain: domain.trim() || null, username: username.trim() || null, folderTemplate: template, ...(password ? { password } : {}) });
        }}
      >
        <div className="sm:col-span-2">
          <Field label="Pasta de destino" hint="Caminho de rede (\\servidor\fiscal\XML_SAAM) ou pasta do servidor liberada pela TI (C:\XML_SAAM)">
            {(a) => <Input {...a} value={path} placeholder="\\servidor\compartilhamento\pasta" spellCheck={false} onChange={(e) => setPath(e.target.value)} className="font-mono text-[13px]" />}
          </Field>
        </div>
        <Field label="Usuário da rede" hint={isNetwork ? 'Conta com permissão de gravação na pasta' : 'Opcional'}>
          {(a) => <Input {...a} value={username} autoComplete="off" onChange={(e) => setUsername(e.target.value)} />}
        </Field>
        <Field label="Domínio" hint="Opcional, por exemplo COOPERFARMS">
          {(a) => <Input {...a} value={domain} autoComplete="off" onChange={(e) => setDomain(e.target.value)} />}
        </Field>
        <Field label="Senha da rede" hint={data.hasPassword ? 'Já cadastrada. Deixe em branco para manter.' : 'Guardada cifrada; nunca é exibida.'}>
          {(a) => <Input {...a} type="password" value={password} autoComplete="new-password" placeholder={data.hasPassword ? '••••••••' : ''} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <div className="space-y-2 sm:col-span-2">
          <Field label="Modelo das subpastas" hint="Separe as pastas com \ e use os marcadores abaixo. Vazio = tudo na pasta de destino." error={templateOk ? undefined : 'Modelo inválido: use letras, números, espaço, . _ - e os marcadores da lista.'}>
            {(a) => <Input {...a} value={template} spellCheck={false} onChange={(e) => setTemplate(e.target.value)} className="font-mono text-[13px]" />}
          </Field>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Modelos prontos">
            <span className="text-xs text-muted">Modelos:</span>
            {XML_ARCHIVE_PRESETS.map((p) => (
              <Button key={p.label} type="button" size="sm" variant={template === p.template ? 'primary' : 'ghost'} onClick={() => setTemplate(p.template)}>
                {p.label}
              </Button>
            ))}
          </div>
          <details className="text-xs text-muted">
            <summary className="cursor-pointer select-none">Marcadores disponíveis</summary>
            <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
              {(Object.keys(XML_ARCHIVE_TOKENS) as XmlArchiveToken[]).map((t) => (
                <li key={t}>
                  <button type="button" className="font-mono text-primary hover:underline" onClick={() => setTemplate((v) => (v ? `${v}\\{${t}}` : `{${t}}`))}>
                    {`{${t}}`}
                  </button>{' '}
                  {XML_ARCHIVE_TOKENS[t]}
                </li>
              ))}
            </ul>
          </details>
          <p className="rounded-md bg-surface-2 px-3 py-2 text-xs text-muted" aria-label="Prévia do caminho">
            Exemplo: <span className="break-all font-mono text-text">{preview}</span>
            <br />
            Arquivos já existentes na pasta não são sobrescritos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" loading={save.isPending} disabled={!dirty || !templateOk}>
            Salvar
          </Button>
          <Button type="button" variant="outline" onClick={() => test.mutate()} loading={test.isPending || testing} disabled={dirty || !data.path}>
            <PlugZap /> Testar conexão
          </Button>
        </div>
      </form>

      <div className="grid gap-4 border-t border-border/70 bg-surface-2/50 p-5 sm:grid-cols-2">
        <div aria-live="polite">
          <div className="text-xs font-medium uppercase tracking-wider text-muted">Último teste</div>
          {testing ? (
            <p className="mt-1 flex items-center gap-2 text-sm text-muted">
              <Loader2 className="size-4 animate-spin" /> Testando a pasta…
            </p>
          ) : data.lastTest ? (
            <p className={cn('mt-1 flex items-start gap-2 text-sm', data.lastTest.ok ? 'text-success' : 'text-danger')}>
              {data.lastTest.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
              <span>
                {data.lastTest.message} <span className="text-xs text-subtle">({formatDateTime(data.lastTest.at)})</span>
              </span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-subtle">Nenhum teste com a pasta atual.</p>
          )}
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted">Situação das cópias</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2" aria-label="Situação das cópias">
            <Badge tone="success" size="sm">
              {data.stats.copied.toLocaleString('pt-BR')} copiados
            </Badge>
            <Badge tone="neutral" size="sm">
              {data.stats.pending.toLocaleString('pt-BR')} na fila
            </Badge>
            <Badge tone={data.stats.failed ? 'danger' : 'neutral'} size="sm">
              {data.stats.failed.toLocaleString('pt-BR')} com erro
            </Badge>
            {data.enabled && data.stats.pending + data.stats.failed > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => retry.mutate()} loading={retry.isPending}>
                <RefreshCw /> Reenviar pendentes
              </Button>
            ) : null}
          </div>
          {data.stats.lastError ? <p className="mt-1.5 text-xs text-danger">Último erro: {data.stats.lastError}</p> : null}
          {data.updatedAt ? <p className="mt-1.5 text-xs text-subtle">Configuração alterada {formatRelative(data.updatedAt)}.</p> : null}
        </div>
      </div>
    </Card>
  );
}
