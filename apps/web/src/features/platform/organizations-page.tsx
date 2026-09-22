'use client';

import {
  MANAGEABLE_ORG_KINDS,
  ORG_KIND_DESCRIPTIONS,
  ORG_KIND_LABELS,
  type ManageableOrgKind,
  type OrganizationListItem,
} from '@ordens/contracts';
import { AsyncCombobox, Badge, Button, Card, cn, Drawer, EmptyState, Field, Input, Skeleton, type ComboOption } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, ShieldOff, Users } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { lookups } from '@/features/orders/orders-api';
import { ApiRequestError, get, patch, post } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useCan, useMe } from '@/lib/session';

const KEY = ['organizations', 'groups'];

const KIND_TONE: Record<string, 'primary' | 'info' | 'warning' | 'neutral'> = {
  MATRIZ: 'primary',
  FARM: 'info',
  BUYER: 'warning',
  CARRIER: 'neutral',
};

/** Parceiros elegíveis para cada tipo de grupo (mesma regra que a API valida). */
const partnersFor = (kind: ManageableOrgKind) => (kind === 'BUYER' ? lookups.buyers() : kind === 'CARRIER' ? lookups.carriers() : lookups.sellers());

/**
 * Grupos de acesso (organizações). Cada pessoa de fora da Matriz pertence a um grupo e só enxerga os
 * dados dele — o isolamento é garantido pelo banco, não só pela tela.
 */
export function OrganizationsPage() {
  const can = useCan();
  const { data: me } = useMe();
  const allowed = can('organization.manage');
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);

  const groups = useQuery({ queryKey: KEY, queryFn: () => get<OrganizationListItem[]>('/organizations/groups'), enabled: allowed });

  const toggle = useMutation({
    mutationFn: (g: OrganizationListItem) => patch(`/organizations/${g.id}`, { status: g.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }),
    onSuccess: (_, g) => {
      void qc.invalidateQueries({ queryKey: KEY });
      toast.success(g.status === 'ACTIVE' ? 'Grupo desativado' : 'Grupo reativado');
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível alterar o grupo.'),
  });

  if (me && !allowed) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState icon={<ShieldOff />} title="Sem acesso aos grupos" description="Somente administradores da Matriz criam e alteram grupos de acesso." />
      </div>
    );
  }

  const list = groups.data ?? [];
  const externos = list.filter((g) => g.kind !== 'MATRIZ');

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
            <Building2 className="size-5" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Grupos de acesso</h1>
            <p className="text-sm text-muted">Cada grupo reúne os usuários de um parceiro. Quem é de um grupo só enxerga os dados dele.</p>
          </div>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus /> Novo grupo
        </Button>
      </div>

      {groups.isLoading ? (
        <Skeleton className="h-64" />
      ) : !externos.length ? (
        <Card className="p-8">
          <EmptyState
            icon={<Building2 />}
            title="Nenhum grupo além da Matriz"
            description="Crie um grupo para cada Comprador, Vendedor ou Transportadora que vai usar o sistema. Depois, cadastre as pessoas dele em Gestão › Usuários."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border/70" aria-label="Grupos de acesso">
            {list.map((g) => (
              <li key={g.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3.5', g.status !== 'ACTIVE' && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium">{g.name}</span>
                    <Badge tone={KIND_TONE[g.kind] ?? 'neutral'} size="sm">
                      {ORG_KIND_LABELS[g.kind]}
                    </Badge>
                    {g.status !== 'ACTIVE' ? (
                      <Badge tone="danger" size="sm">
                        Desativado
                      </Badge>
                    ) : null}
                  </div>
                  <div className="text-xs text-subtle">
                    {g.partner ? `${g.partner.name} · ${g.partner.document}` : 'Sem parceiro vinculado'} · criado em {formatDate(g.createdAt)}
                  </div>
                </div>
                <span className="inline-flex items-center gap-1.5 text-sm text-muted" title="Acessos ativos neste grupo">
                  <Users className="size-4" />
                  {g.usersCount}
                </span>
                {g.kind !== 'MATRIZ' ? (
                  <Button variant="ghost" size="sm" loading={toggle.isPending && toggle.variables?.id === g.id} onClick={() => toggle.mutate(g)}>
                    {g.status === 'ACTIVE' ? 'Desativar' : 'Reativar'}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <CreateDrawer open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ManageableOrgKind>('BUYER');
  const [partner, setPartner] = useState<ComboOption | null>(null);
  const [name, setName] = useState('');

  const reset = () => {
    setKind('BUYER');
    setPartner(null);
    setName('');
  };

  const create = useMutation({
    mutationFn: () => post('/organizations', { kind, partnerId: partner!.id, ...(name.trim() ? { name: name.trim() } : {}) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEY });
      void qc.invalidateQueries({ queryKey: ['partners'] });
      toast.success('Grupo criado', { description: 'Agora cadastre as pessoas dele em Gestão › Usuários.' });
      reset();
      onClose();
    },
    onError: (err) => toast.error(err instanceof ApiRequestError ? err.message : 'Não foi possível criar o grupo.'),
  });

  return (
    <Drawer
      open={open}
      size="md"
      onRequestClose={onClose}
      title="Novo grupo de acesso"
      subtitle="Vincule um parceiro já cadastrado. O tipo define o que as pessoas do grupo podem fazer."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!partner}>
            Criar grupo
          </Button>
        </div>
      }
    >
      <div className="space-y-5 p-5 sm:p-7">
        <fieldset>
          <legend className="text-sm font-medium">Tipo do grupo</legend>
          <div className="mt-2 space-y-2" role="radiogroup" aria-label="Tipo do grupo">
            {MANAGEABLE_ORG_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => {
                  setKind(k);
                  setPartner(null);
                }}
                className={cn(
                  'flex w-full flex-col gap-0.5 rounded-lg p-3 text-left ring-1 ring-border/60 transition hover:bg-surface-2',
                  kind === k && 'bg-primary-soft/40 ring-2 ring-primary/50',
                )}
              >
                <span className="text-sm font-semibold">{ORG_KIND_LABELS[k]}</span>
                <span className="text-xs text-muted">{ORG_KIND_DESCRIPTIONS[k]}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="Parceiro" hint="Só aparecem parceiros com o papel compatível com o tipo escolhido.">
          {(a) => <AsyncCombobox {...a} value={partner} onChange={setPartner} queryKey={['lookup', 'org-partner', kind]} fetchPage={partnersFor(kind)} placeholder="Busque por nome ou documento" />}
        </Field>

        <Field label="Nome do grupo" hint="Opcional. Em branco, usa o nome do parceiro.">
          {(a) => <Input {...a} value={name} maxLength={160} onChange={(e) => setName(e.target.value)} />}
        </Field>
      </div>
    </Drawer>
  );
}
