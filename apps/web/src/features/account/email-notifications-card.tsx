'use client';

import { EMAIL_NOTIFICATION_TYPE_KEYS, EMAIL_NOTIFICATION_TYPES, type EmailNotificationType } from '@ordens/contracts';
import { Button, Card, cn, Skeleton } from '@ordens/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { get, put } from '@/lib/api';
import { useMe } from '@/lib/session';

interface Prefs {
  enabled: boolean;
  types: Record<EmailNotificationType, boolean>;
}

const KEY = ['me', 'notification-preferences'];

/** Q44: o aviso no sistema é sempre enviado; aqui o usuário escolhe o que também chega por e-mail. */
export function EmailNotificationsCard() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const scope = me?.activeMembership?.scope;
  const saved = useQuery({ queryKey: KEY, queryFn: () => get<Prefs>('/me/notification-preferences') });
  const [draft, setDraft] = useState<Prefs | null>(null);
  useEffect(() => {
    if (saved.data) setDraft(saved.data);
  }, [saved.data]);

  const save = useMutation({
    mutationFn: (p: Prefs) => put<Prefs>('/me/notification-preferences', p),
    onSuccess: (p) => {
      qc.setQueryData(KEY, p);
      toast.success('Preferências de e-mail salvas');
    },
    onError: () => toast.error('Não foi possível salvar as preferências.'),
  });

  const visible = EMAIL_NOTIFICATION_TYPE_KEYS.filter((k) => !scope || (EMAIL_NOTIFICATION_TYPES[k].scopes as readonly string[]).includes(scope));
  const groups = [...new Set(visible.map((k) => EMAIL_NOTIFICATION_TYPES[k].group))];
  const dirty = Boolean(draft && saved.data && JSON.stringify(draft) !== JSON.stringify(saved.data));

  return (
    <Card className="p-6">
      <div className="mb-1 flex items-center gap-3">
        <Mail className="size-5 text-muted" />
        <h2 className="font-semibold">Notificações por e-mail</h2>
      </div>
      <p className="mb-4 text-sm text-muted">
        Os avisos continuam aparecendo no sino. Escolha quais também chegam em <span className="font-medium text-text">{me?.user.email}</span>.
      </p>
      {!draft ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : (
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2.5 ring-1 ring-border hover:bg-surface-2">
            <input type="checkbox" className="size-4 accent-[var(--color-primary)]" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
            <span className="text-sm font-medium">Receber avisos por e-mail</span>
          </label>
          <div className={cn('grid gap-4 sm:grid-cols-2', !draft.enabled && 'pointer-events-none opacity-50')} aria-disabled={!draft.enabled}>
            {groups.map((group) => (
              <fieldset key={group} className="space-y-1">
                <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-muted">{group}</legend>
                {visible
                  .filter((k) => EMAIL_NOTIFICATION_TYPES[k].group === group)
                  .map((k) => (
                    <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-surface-2">
                      <input
                        type="checkbox"
                        className="size-4 accent-[var(--color-primary)]"
                        disabled={!draft.enabled}
                        checked={draft.types[k]}
                        onChange={(e) => setDraft({ ...draft, types: { ...draft.types, [k]: e.target.checked } })}
                      />
                      {EMAIL_NOTIFICATION_TYPES[k].label}
                    </label>
                  ))}
              </fieldset>
            ))}
          </div>
          <Button variant="outline" disabled={!dirty} loading={save.isPending} onClick={() => draft && save.mutate(draft)}>
            Salvar preferências
          </Button>
        </div>
      )}
    </Card>
  );
}
