'use client';

import { PASSKEY_MAX_PER_USER, type PasskeyDto } from '@ordens/contracts';
import { Badge, Button, Card, Field, Input, Skeleton } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cloud, Fingerprint, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/features/orders/confirm-dialog';
import { ApiRequestError, del, get, patch } from '@/lib/api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { browserSupportsWebAuthn, passkeyCancelled, registerPasskey, suggestedPasskeyName } from '@/lib/passkeys';

const KEY = ['passkeys'];

/** Passkeys: entrar com biometria ou PIN do aparelho, sem senha e sem código 2FA. */
export function PasskeysCard() {
  const qc = useQueryClient();
  const passkeys = useQuery({ queryKey: KEY, queryFn: () => get<PasskeyDto[]>('/auth/passkeys') });
  const [supported, setSupported] = useState(true);
  const [adding, setAdding] = useState(false);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<PasskeyDto | null>(null);
  useEffect(() => setSupported(browserSupportsWebAuthn()), []);

  const add = useMutation({
    mutationFn: () => registerPasskey(password, name.trim()),
    onSuccess: (p) => {
      qc.setQueryData<PasskeyDto[]>(KEY, (list) => [...(list ?? []), p]);
      toast.success('Passkey cadastrada', { description: 'No próximo acesso, use "Entrar com passkey".' });
      setAdding(false);
      setPassword('');
    },
    onError: (err) => {
      if (passkeyCancelled(err)) return;
      toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível cadastrar a passkey.');
    },
  });

  const rename = useMutation({
    mutationFn: (v: { id: string; name: string }) => patch(`/auth/passkeys/${v.id}`, { name: v.name.trim() }),
    onSuccess: () => {
      setEditing(null);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível renomear.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => del(`/auth/passkeys/${id}`),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success('Passkey removida');
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível remover.'),
  });

  const list = passkeys.data ?? [];

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Fingerprint className="size-5 text-muted" />
          <div>
            <h2 className="font-semibold">Passkeys</h2>
            <p className="text-xs text-muted">Entre com a biometria ou o PIN do aparelho, sem senha. Vale como verificação em duas etapas.</p>
          </div>
        </div>
        {!adding ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!supported || list.length >= PASSKEY_MAX_PER_USER}
            onClick={() => {
              setName(suggestedPasskeyName());
              setAdding(true);
            }}
          >
            <Plus /> Adicionar passkey
          </Button>
        ) : null}
      </div>

      {!supported ? <p className="mb-3 text-sm text-warning">Este navegador não suporta passkeys.</p> : null}

      {adding ? (
        <form
          className="mb-4 grid gap-4 rounded-lg bg-surface-2 p-4 sm:grid-cols-2"
          aria-label="Nova passkey"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Nome" hint="Para reconhecer o aparelho depois">
            {(a) => <Input {...a} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Senha atual" hint="Confirma que é você">
            {(a) => <Input {...a} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" loading={add.isPending} disabled={!password || !name.trim()}>
              <Fingerprint /> Cadastrar neste aparelho
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : null}

      {passkeys.isLoading ? (
        <Skeleton className="h-16" />
      ) : !list.length ? (
        <p className="text-sm text-subtle">Nenhuma passkey cadastrada.</p>
      ) : (
        <ul className="divide-y divide-border/70" aria-label="Passkeys cadastradas">
          {list.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                {editing?.id === p.id ? (
                  <form
                    className="flex gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      rename.mutate(editing);
                    }}
                  >
                    <Input aria-label="Novo nome" value={editing.name} maxLength={60} autoFocus onChange={(e) => setEditing({ id: p.id, name: e.target.value })} className="max-w-72" />
                    <Button type="submit" size="sm" loading={rename.isPending} disabled={!editing.name.trim()}>
                      Salvar
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancelar
                    </Button>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {p.name}
                    {p.backedUp ? (
                      <Badge tone="info" size="sm">
                        <Cloud /> Sincronizada
                      </Badge>
                    ) : null}
                  </div>
                )}
                <div className="text-xs text-muted">
                  Criada em {formatDateTime(p.createdAt)} · {p.lastUsedAt ? `usada ${formatRelative(p.lastUsedAt)}` : 'ainda não usada'}
                </div>
              </div>
              {editing?.id !== p.id ? (
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" aria-label={`Renomear ${p.name}`} onClick={() => setEditing({ id: p.id, name: p.name })}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Remover ${p.name}`} onClick={() => setRemoving(p)}>
                    <Trash2 />
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={removing !== null}
        title="Remover passkey?"
        description={`"${removing?.name ?? ''}" deixa de entrar na plataforma. Apague também a passkey no aparelho ou no gerenciador de senhas.`}
        confirmLabel="Remover"
        cancelLabel="Cancelar"
        onCancel={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
      />
    </Card>
  );
}
