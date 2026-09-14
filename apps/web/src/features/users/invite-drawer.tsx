'use client';

import { Button, Drawer, Field, Input, Select } from '@ordens/ui';
import { Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormSection, span } from '@/features/registry/form-utils';
import { ApiRequestError } from '@/lib/api';
import { RolePicker } from './role-picker';
import { ORG_KIND_LABELS } from './roles';
import { useOrganizations, useUserMutations } from './users-api';

type Errors = Partial<Record<'name' | 'email' | 'organizationId' | 'roles', string>>;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Convite: cria o acesso na organização e envia o link para definir a senha (72 h). */
export function InviteDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const orgs = useOrganizations();
  const { invite } = useUserMutations();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [roles, setRoles] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});

  const activeOrgs = (orgs.data ?? []).filter((o) => o.status === 'ACTIVE');
  const org = activeOrgs.find((o) => o.id === organizationId);

  useEffect(() => {
    if (!open) return;
    setName('');
    setEmail('');
    setRoles([]);
    setErrors({});
    setOrganizationId(activeOrgs.length === 1 ? activeOrgs[0]!.id : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, orgs.data]);

  const submit = async () => {
    const next: Errors = {};
    if (name.trim().length < 2) next.name = 'Informe o nome';
    if (!EMAIL.test(email.trim())) next.email = 'Informe um e-mail válido';
    if (!organizationId) next.organizationId = 'Selecione a organização';
    if (!roles.length) next.roles = 'Selecione ao menos um papel';
    setErrors(next);
    if (Object.keys(next).length) return;
    try {
      const result = await invite.mutateAsync({ name: name.trim(), email: email.trim().toLowerCase(), organizationId, roles });
      toast.success(result.invited ? `Convite enviado para ${email.trim().toLowerCase()}` : `${name.trim()} já tinha conta: acesso adicionado.`);
      onClose();
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0]])) as Errors);
        toast.error(err.message);
      } else toast.error('Não foi possível enviar o convite.');
    }
  };

  return (
    <Drawer
      open={open}
      onRequestClose={onClose}
      size="md"
      title="Convidar usuário"
      subtitle="A pessoa recebe um e-mail para definir a senha. Se já tiver conta, o acesso é adicionado."
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={invite.isPending}>
            <Send /> Enviar convite
          </Button>
        </div>
      }
    >
      <FormSection title="Pessoa">
        <Field label="Nome" required error={errors.name} className={span[6]}>
          {(a) => <Input {...a} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
        </Field>
        <Field label="E-mail" required error={errors.email} className={span[6]}>
          {(a) => <Input {...a} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />}
        </Field>
      </FormSection>
      <FormSection title="Acesso" description="Os papéis disponíveis dependem do tipo da organização.">
        <Field label="Organização" required error={errors.organizationId} className={span[6]}>
          {(a) => (
            <Select
              {...a}
              value={organizationId}
              onChange={(e) => {
                setOrganizationId(e.target.value);
                setRoles([]);
              }}
              placeholder={orgs.isLoading ? 'Carregando…' : 'Selecione'}
              options={activeOrgs.map((o) => ({ value: o.id, label: `${o.name} · ${ORG_KIND_LABELS[o.kind] ?? o.kind}` }))}
            />
          )}
        </Field>
        <div className="sm:col-span-6">
          <RolePicker kind={org?.kind ?? ''} value={roles} onChange={setRoles} error={errors.roles} />
        </div>
      </FormSection>
    </Drawer>
  );
}
