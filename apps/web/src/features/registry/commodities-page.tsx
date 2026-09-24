'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { commodityInputSchema, type CommodityListItem } from '@ordens/contracts';
import { Button, Drawer, Field, Input, Select, Textarea } from '@ordens/ui';
import { Archive, Check, Wheat } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import type { z } from 'zod';
import { useUnits } from '@/features/orders/orders-api';
import { post, put } from '@/lib/api';
import { useCan } from '@/lib/session';
import { FormSection, handleSaveError, span, useInvalidateRegistry } from './form-utils';
import { RegistryList, StatusPill } from './registry-list';


const STATUS_OPTS = [
  { value: 'ACTIVE', label: 'Ativo' },
  { value: 'INACTIVE', label: 'Inativo' },
  { value: 'BLOCKED', label: 'Bloqueado' },
];

function FormFooter({ readOnly, onClose, onSave, saving, onArchive }: { readOnly: boolean; onClose: () => void; onSave: () => void; saving: boolean; onArchive?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {onArchive && !readOnly ? (
        <Button variant="ghost" onClick={onArchive}>
          <Archive /> Arquivar
        </Button>
      ) : null}
      <div className="ml-auto flex gap-2">
        <Button variant="ghost" onClick={onClose}>
          {readOnly ? 'Fechar' : 'Cancelar'}
        </Button>
        {!readOnly ? (
          <Button onClick={onSave} loading={saving}>
            <Check /> Salvar
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type CommodityValues = z.input<typeof commodityInputSchema>;

function CommodityDrawer({ row, open, onClose }: { row: CommodityListItem | null; open: boolean; onClose: () => void }) {
  const can = useCan();
  const readOnly = !can('commodity.manage');
  const invalidate = useInvalidateRegistry();
  const units = useUnits();
  const form = useForm<CommodityValues, unknown, z.output<typeof commodityInputSchema>>({ resolver: zodResolver(commodityInputSchema) });
  const errors = form.formState.errors;

  useEffect(() => {
    if (!open) return;
    form.reset(
      row
        ? { code: row.code, name: row.name, category: row.category ?? '', defaultUnitId: row.defaultUnit?.id ?? null, description: row.description ?? '', status: row.status }
        : { code: '', name: '', category: '', defaultUnitId: null, description: '', status: 'ACTIVE' },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const submit = form.handleSubmit(async (values) => {
    try {
      if (row) await put(`/commodities/${row.id}`, values);
      else await post('/commodities', values);
      toast.success(row ? 'Commodity atualizada' : 'Commodity cadastrada');
      invalidate('commodities');
      onClose();
    } catch (err) {
      handleSaveError(err, form.setError);
    }
  });

  return (
    <Drawer open={open} size="md" onRequestClose={onClose} title={row ? row.name : 'Nova commodity'} footer={<FormFooter readOnly={readOnly} onClose={onClose} onSave={() => void submit()} saving={form.formState.isSubmitting} />}>
      <form onSubmit={submit} noValidate>
        <fieldset disabled={readOnly} className="contents">
          <FormSection title="Produto">
            <Field label="Código" required className={span[2]} error={errors.code?.message}>
              {(a) => <Input {...a} className="font-mono uppercase" {...form.register('code')} />}
            </Field>
            <Field label="Nome" required className={span[4]} error={errors.name?.message}>
              {(a) => <Input {...a} {...form.register('name')} />}
            </Field>
            <Field label="Categoria" className={span[3]}>
              {(a) => <Input {...a} {...form.register('category')} placeholder="Grãos, fibras…" />}
            </Field>
            <Field label="Unidade padrão" className={span[3]}>
              {(a) => (
                <Select
                  {...a}
                  {...form.register('defaultUnitId', { setValueAs: (v: string) => v || null })}
                  placeholder="—"
                  options={(units.data ?? []).map((u) => ({ value: u.id, label: `${u.label} · ${u.description}` }))}
                />
              )}
            </Field>
            <Field label="Status" className={span[3]}>
              {(a) => <Select {...a} {...form.register('status')} options={STATUS_OPTS} />}
            </Field>
            <Field label="Descrição" className={span[6]}>
              {(a) => <Textarea {...a} rows={3} {...form.register('description')} />}
            </Field>
          </FormSection>
        </fieldset>
      </form>
    </Drawer>
  );
}

export function CommoditiesPage() {
  const can = useCan();
  const [open, setOpen] = useState<CommodityListItem | null | 'new'>(null);
  return (
    <>
      <RegistryList<CommodityListItem>
        title="Commodities"
        description="Produtos negociados e unidade padrão de cada um."
        icon={<Wheat />}
        endpoint="/commodities"
        queryKey="commodities"
        searchPlaceholder="Buscar por nome, código ou categoria…"
        createLabel="Nova commodity"
        onCreate={can('commodity.manage') ? () => setOpen('new') : undefined}
        onOpen={(r) => setOpen(r)}
        columns={[
          { key: 'code', header: 'Código', width: '140px', render: (c) => <span className="font-mono text-[13px]">{c.code}</span> },
          { key: 'name', header: 'Nome', render: (c) => <span className="font-medium">{c.name}</span> },
          { key: 'category', header: 'Categoria', render: (c) => c.category ?? <span className="text-subtle">—</span> },
          { key: 'unit', header: 'Unidade', width: '110px', render: (c) => c.defaultUnit?.code ?? '—' },
          { key: 'orders', header: 'Ordens', width: '90px', align: 'right', render: (c) => <span className="tabular">{c.ordersCount}</span> },
          { key: 'status', header: 'Status', width: '100px', render: (c) => <StatusPill status={c.status} /> },
        ]}
        renderCard={(c) => (
          <div className="flex justify-between gap-2">
            <span>
              <span className="font-medium">{c.name}</span> <span className="font-mono text-xs text-muted">{c.code}</span>
            </span>
            <StatusPill status={c.status} />
          </div>
        )}
      />
      <CommodityDrawer row={open === 'new' ? null : open} open={open !== null} onClose={() => setOpen(null)} />
    </>
  );
}
