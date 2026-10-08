'use client';

import { Badge, Button, Card, EmptyState } from '@ordens/ui';
import { ArrowLeft, BookOpen, Check, Info, Minus } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { GUIDE_PROFILES, guideProfile } from '@/features/guide/guide-content';
import { Shot } from '@/features/guide/shot';

export default function GuideProfilePage({ params }: { params: Promise<{ perfil: string }> }) {
  const { perfil } = use(params);
  const profile = guideProfile(perfil);

  if (!profile) {
    return (
      <EmptyState
        className="py-24"
        icon={<BookOpen />}
        title="Capítulo não encontrado"
        description="Este perfil não existe no guia."
        action={
          <Button asChild variant="outline">
            <Link href="/guia">Voltar ao guia</Link>
          </Button>
        }
      />
    );
  }

  const siblings = GUIDE_PROFILES.filter((p) => p.group === profile.group && p.slug !== profile.slug);

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/guia" className="inline-flex items-center gap-1.5 text-[13px] text-muted hover:text-text">
        <ArrowLeft className="size-4" /> Guia de uso
      </Link>

      <div className="mt-3 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Sumário do capítulo */}
        <nav aria-label="Tarefas deste perfil" className="hidden lg:block">
          <div className="sticky top-4 space-y-1 text-sm">
            <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-subtle">Neste capítulo</div>
            {profile.tasks.map((t, i) => (
              <a key={t.id} href={`#${t.id}`} className="flex gap-2 rounded-md px-2 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
                <span className="w-5 shrink-0 font-mono text-xs leading-5 text-subtle">{String(i + 1).padStart(2, '0')}</span>
                {t.title}
              </a>
            ))}
            {siblings.length ? (
              <>
                <div className="px-2 pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-subtle">Outros perfis · {profile.group}</div>
                {siblings.map((p) => (
                  <Link key={p.slug} href={`/guia/${p.slug}`} className="block rounded-md px-2 py-1.5 text-muted hover:bg-surface-2 hover:text-text">
                    {p.name}
                  </Link>
                ))}
              </>
            ) : null}
          </div>
        </nav>

        <div className="min-w-0 space-y-6">
          <header className="space-y-2">
            <Badge tone="primary">{profile.group}</Badge>
            <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
            <p className="max-w-2xl text-muted">{profile.tagline}</p>
          </header>

          {profile.does.length || profile.doesNot.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              <Card className="p-4">
                <h2 className="text-sm font-semibold">O que este perfil faz</h2>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {profile.does.map((d) => (
                    <li key={d} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" /> {d}
                    </li>
                  ))}
                </ul>
              </Card>
              {profile.doesNot.length ? (
                <Card className="p-4">
                  <h2 className="text-sm font-semibold">O que não faz</h2>
                  <ul className="mt-2 space-y-1.5 text-sm text-muted">
                    {profile.doesNot.map((d) => (
                      <li key={d} className="flex gap-2">
                        <Minus className="mt-0.5 size-4 shrink-0 text-subtle" /> {d}
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
            </div>
          ) : null}

          {profile.menu.length ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">O que aparece no seu menu</h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.menu.map((m) => (
                  <Badge key={m}>{m}</Badge>
                ))}
              </div>
            </Card>
          ) : null}

          {profile.tasks.map((t, i) => (
            <section key={t.id} id={t.id} className="scroll-mt-4">
              <Card className="overflow-hidden">
                <div className="space-y-3 p-5">
                  <div className="flex items-baseline gap-3">
                    <span className="font-mono text-sm text-primary">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <h2 className="text-lg font-semibold tracking-tight">{t.title}</h2>
                      <p className="text-sm text-muted">{t.summary}</p>
                    </div>
                  </div>
                  <ol className="space-y-2 text-sm">
                    {t.steps.map((s, n) => (
                      <li key={n} className="flex gap-3">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary-soft text-[11px] font-semibold text-primary">{n + 1}</span>
                        <span className="leading-relaxed">{s}</span>
                      </li>
                    ))}
                  </ol>
                  {t.note ? (
                    <p className="flex gap-2 rounded-md bg-info-soft px-3 py-2 text-sm text-info">
                      <Info className="mt-0.5 size-4 shrink-0" /> {t.note}
                    </p>
                  ) : null}
                </div>
                {t.shot ? (
                  <div className="border-t border-border/70 bg-surface-2 p-3 sm:p-5">
                    <Shot shot={t.shot} />
                  </div>
                ) : null}
              </Card>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
