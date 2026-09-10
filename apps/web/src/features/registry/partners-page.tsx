'use client';

import { PARTNER_ROLE_LABELS, type PartnerListItem, type PartnerRole } from '@ordens/contracts';
import { Badge, Tooltip } from '@ordens/ui';
import { Globe } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { formatQty } from '@/lib/format';
import { useCan } from '@/lib/session';
import { PartnerDrawer } from './partner-drawer';
import { RegistryList, StatusPill } from './registry-list';

export function PartnersPage({ role, title, description, icon, entityLabel }: { role: PartnerRole; title: string; description: string; icon: ReactNode; entityLabel: string }) {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const id = params.get('abrir');
    if (id) setOpenId(id);
  }, [params]);

  const close = () => {
    setOpenId(null);
    setCreating(false);
    if (params.get('abrir')) router.replace(window.location.pathname, { scroll: false });
  };

  return (
    <>
      <RegistryList<PartnerListItem>
        title={title}
        description={description}
        icon={icon}
        endpoint="/partners"
        queryKey="partners"
        query={{ role }}
        searchPlaceholder="Buscar por nome, CPF/CNPJ ou município…"
        createLabel={`Novo ${entityLabel.toLowerCase()}`}
        onCreate={can('partner.manage') ? () => setCreating(true) : undefined}
        onOpen={(r) => setOpenId(r.id)}
        columns={[
          {
            key: 'name',
            header: 'Nome',
            render: (p) => (
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate font-medium">
                  {p.tradeName ?? p.legalName}
                  {p.hasPortal ? (
                    <Tooltip content="Possui organização com acesso ao portal">
                      <Globe className="size-3.5 text-primary" aria-label="Acesso ao portal" />
                    </Tooltip>
                  ) : null}
                </div>
                <div className="truncate text-xs text-subtle">{p.tradeName ? p.legalName : p.personType === 'PF' ? 'Pessoa física' : 'Pessoa jurídica'}</div>
              </div>
            ),
          },
          { key: 'document', header: 'CPF/CNPJ', width: '180px', render: (p) => <span className="font-mono text-[13px]">{p.document}</span> },
          {
            key: 'roles',
            header: 'Papéis',
            render: (p) => (
              <div className="flex flex-wrap gap-1">
                {p.roles.map((r) => (
                  <Badge key={r} size="sm" tone={r === role ? 'primary' : 'neutral'}>
                    {PARTNER_ROLE_LABELS[r]}
                  </Badge>
                ))}
              </div>
            ),
          },
          { key: 'city', header: 'Município', width: '180px', render: (p) => (p.city ? `${p.city}/${p.state}` : <span className="text-subtle">—</span>) },
          ...(role === 'SELLER' ? [{ key: 'farms', header: 'Fazendas', width: '100px', align: 'right' as const, render: (p: PartnerListItem) => <span className="tabular">{p.farmsCount}</span> }] : []),
          ...(role !== 'CARRIER'
            ? [
                { key: 'orders', header: 'Ordens', width: '90px', align: 'right' as const, render: (p: PartnerListItem) => <span className="tabular">{p.ordersCount}</span> },
                { key: 'open', header: 'Em aberto', width: '120px', align: 'right' as const, render: (p: PartnerListItem) => <span className="tabular">{formatQty(p.openQuantity, 't')}</span> },
              ]
            : []),
          { key: 'status', header: 'Status', width: '110px', render: (p) => <StatusPill status={p.status} archived={p.archived} /> },
        ]}
        renderCard={(p) => (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{p.tradeName ?? p.legalName}</span>
              <StatusPill status={p.status} archived={p.archived} />
            </div>
            <div className="font-mono text-xs text-muted">{p.document}</div>
            <div className="text-xs text-subtle">
              {p.city ? `${p.city}/${p.state} · ` : ''}
              {role === 'SELLER' ? `${p.farmsCount} fazenda(s) · ` : ''}
              {p.ordersCount} ordem(ns)
            </div>
          </div>
        )}
      />
      <PartnerDrawer id={openId} open={Boolean(openId) || creating} defaultRoles={[role]} onClose={close} entityLabel={entityLabel} />
    </>
  );
}
