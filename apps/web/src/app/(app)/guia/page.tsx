'use client';

import { Badge, Card } from '@ordens/ui';
import { ArrowRight, BookOpen, Presentation } from 'lucide-react';
import Link from 'next/link';
import { GUIDE_GROUPS, GUIDE_PROFILES, profileForUser } from '@/features/guide/guide-content';
import { useMe } from '@/lib/session';

/** Guia de uso: um capítulo por tipo de usuário, com o de quem está logado em destaque. */
export default function GuideIndexPage() {
  const { data: me } = useMe();
  const mine = profileForUser(me?.activeMembership?.roles, me?.activeMembership?.scope);

  return (
    <div className="mx-auto max-w-[1100px] space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <BookOpen className="size-6 text-primary" /> Guia de uso
          </h1>
          <p className="max-w-2xl text-sm text-muted">Passo a passo de cada tarefa, separado por tipo de usuário. Escolha o seu perfil ou consulte o de quem trabalha com você.</p>
        </div>
        <Link href="/apresentacao" className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-primary ring-1 ring-border hover:bg-surface-2">
          <Presentation className="size-4" /> Ver a apresentação
        </Link>
      </div>

      {mine ? (
        <Link href={`/guia/${mine.slug}`} className="block rounded-xl bg-primary-soft p-5 ring-1 ring-primary/20 transition hover:ring-primary/50">
          <div className="text-xs font-semibold uppercase tracking-wide text-primary">Seu perfil</div>
          <div className="mt-1 flex items-center justify-between gap-4">
            <div>
              <div className="text-lg font-semibold">{mine.name}</div>
              <p className="text-sm text-muted">{mine.tagline}</p>
            </div>
            <ArrowRight className="size-5 shrink-0 text-primary" />
          </div>
        </Link>
      ) : null}

      {GUIDE_GROUPS.map((group) => (
        <section key={group} className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-subtle">{group}</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {GUIDE_PROFILES.filter((p) => p.group === group).map((p) => (
              <Link key={p.slug} href={`/guia/${p.slug}`} className="group">
                <Card className="flex h-full flex-col gap-2 p-4 transition group-hover:ring-primary/50">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{p.name}</span>
                    {mine?.slug === p.slug ? <Badge tone="primary">Você</Badge> : null}
                  </div>
                  <p className="flex-1 text-sm text-muted">{p.tagline}</p>
                  <span className="text-xs text-subtle">{p.tasks.length} tarefas</span>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
