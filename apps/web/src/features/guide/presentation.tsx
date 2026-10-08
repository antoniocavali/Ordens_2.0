'use client';

import { cn } from '@ordens/ui';
import { ArrowLeft, ArrowRight, BookOpen, LogIn, Maximize, Pause, Play } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from '@/features/auth/auth-showcase';
import { SLIDES } from './presentation-content';
import { shotSrc } from './shot';

/** Tempo de cada tela na reprodução automática. */
const FRAME_MS = 7000;

/**
 * Apresentação institucional: capítulos com telas reais do sistema. Avança sozinha (pausável), por
 * teclado (← → espaço) ou pelos controles. Tem cores próprias, sempre escuras, independentes do tema.
 */
export function Presentation() {
  const [pos, setPos] = useState({ slide: 0, frame: 0 });
  const [playing, setPlaying] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const slide = SLIDES[pos.slide]!;
  const frame = slide.frames[pos.frame]!;
  const isLast = pos.slide === SLIDES.length - 1 && pos.frame === slide.frames.length - 1;

  const next = useCallback(() => {
    setPos((p) => {
      const s = SLIDES[p.slide]!;
      if (p.frame + 1 < s.frames.length) return { slide: p.slide, frame: p.frame + 1 };
      if (p.slide + 1 < SLIDES.length) return { slide: p.slide + 1, frame: 0 };
      return p;
    });
  }, []);
  const prev = useCallback(() => {
    setPos((p) => {
      if (p.frame > 0) return { slide: p.slide, frame: p.frame - 1 };
      if (p.slide > 0) return { slide: p.slide - 1, frame: SLIDES[p.slide - 1]!.frames.length - 1 };
      return p;
    });
  }, []);

  // Começa reproduzindo, a menos que a pessoa prefira menos movimento.
  useEffect(() => {
    setPlaying(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (!playing) return;
    if (isLast) {
      setPlaying(false);
      return;
    }
    const tick = () => {
      if (!document.hidden) next();
    };
    const timer = window.setTimeout(tick, FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [playing, pos, isLast, next]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
      else if (e.key === ' ') {
        e.preventDefault();
        setPlaying((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev]);

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.();
  };

  return (
    <div ref={stage} className="relative flex min-h-dvh flex-col overflow-hidden bg-[#140b29] text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(1100px_560px_at_85%_-10%,rgb(139_92_246/0.32),transparent_60%),radial-gradient(800px_480px_at_0%_110%,rgb(79_70_229/0.26),transparent_60%)]" />

      <header className="relative flex items-center justify-between gap-3 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Cooperfarms</span>
          <span className="hidden rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70 sm:inline">Ordens</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setPlaying((v) => !v)} aria-label={playing ? 'Pausar' : 'Reproduzir'} className="grid size-9 place-items-center rounded-md text-white/80 hover:bg-white/10">
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button type="button" onClick={fullscreen} aria-label="Tela cheia" className="hidden size-9 place-items-center rounded-md text-white/80 hover:bg-white/10 sm:grid">
            <Maximize className="size-4" />
          </button>
          <Link href="/login" className="ml-1 inline-flex items-center gap-2 rounded-md bg-white px-3 py-2 text-sm font-semibold text-[#2e1065] hover:bg-white/90">
            <LogIn className="size-4" /> Entrar
          </Link>
        </div>
      </header>

      <main className="relative grid flex-1 items-center gap-6 px-4 pb-4 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)] lg:gap-10">
        <section aria-live="polite" className="space-y-5">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-violet-300">{slide.kicker}</div>
          <h1 className="text-balance text-3xl font-semibold leading-[1.1] tracking-tight sm:text-4xl xl:text-[44px]">{slide.title}</h1>
          <p className="max-w-xl text-[15px] leading-relaxed text-white/70 sm:text-base">{slide.intro}</p>

          {slide.closing ? (
            <div className="flex flex-wrap gap-3 pt-1">
              <Link href="/login" className="inline-flex items-center gap-2 rounded-md bg-violet-500 px-4 py-2.5 text-sm font-semibold hover:bg-violet-400">
                <LogIn className="size-4" /> Entrar na plataforma
              </Link>
              <Link href="/guia" className="inline-flex items-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold ring-1 ring-white/25 hover:bg-white/10">
                <BookOpen className="size-4" /> Guia de uso por perfil
              </Link>
            </div>
          ) : (
            <ol className="space-y-1.5">
              {slide.frames.map((fr, i) => {
                const active = i === pos.frame;
                return (
                  <li key={fr.file}>
                    <button
                      type="button"
                      onClick={() => setPos({ slide: pos.slide, frame: i })}
                      aria-current={active ? 'step' : undefined}
                      className={cn('relative block w-full overflow-hidden rounded-lg px-4 py-3 text-left transition', active ? 'bg-white/10 ring-1 ring-white/15' : 'hover:bg-white/5')}
                    >
                      <div className={cn('text-sm font-semibold', active ? 'text-white' : 'text-white/60')}>{fr.label}</div>
                      {active ? <div className="mt-0.5 text-sm leading-relaxed text-white/70">{fr.text}</div> : null}
                      {active && playing ? <span key={`${pos.slide}-${i}`} className="absolute bottom-0 left-0 h-0.5 w-full origin-left animate-[apresentacao-progresso_linear_forwards] bg-violet-400" style={{ animationDuration: `${FRAME_MS}ms` }} /> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <figure className="min-w-0">
          <div className="overflow-hidden rounded-xl bg-white/5 shadow-2xl ring-1 ring-white/15">
            <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="size-2.5 rounded-full bg-white/20" />
              <span className="ml-3 truncate text-xs text-white/50">{frame.label}</span>
            </div>
            <img key={frame.file} src={shotSrc(frame.file)} alt={`${frame.label}: ${frame.text}`} width={1440} height={900} className="block h-auto w-full animate-in fade-in duration-500" />
          </div>
          {slide.closing ? null : <figcaption className="sr-only">{frame.text}</figcaption>}
        </figure>
      </main>

      <footer className="relative flex items-center gap-3 px-4 pb-4 sm:px-8">
        <button type="button" onClick={prev} disabled={pos.slide === 0 && pos.frame === 0} aria-label="Anterior" className="grid size-9 shrink-0 place-items-center rounded-md ring-1 ring-white/20 hover:bg-white/10 disabled:opacity-30">
          <ArrowLeft className="size-4" />
        </button>
        <nav aria-label="Capítulos" className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {SLIDES.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setPos({ slide: i, frame: 0 })}
              aria-current={i === pos.slide ? 'true' : undefined}
              className={cn('group min-w-16 flex-1 text-left', i === pos.slide ? 'text-white' : 'text-white/45 hover:text-white/80')}
            >
              <span className={cn('block h-1 rounded-full', i < pos.slide ? 'bg-violet-400/70' : i === pos.slide ? 'bg-violet-400' : 'bg-white/15')} />
              <span className="mt-1.5 hidden truncate text-[11px] font-medium md:block">{s.nav}</span>
            </button>
          ))}
        </nav>
        <button type="button" onClick={next} disabled={isLast} aria-label="Próximo" className="grid size-9 shrink-0 place-items-center rounded-md ring-1 ring-white/20 hover:bg-white/10 disabled:opacity-30">
          <ArrowRight className="size-4" />
        </button>
      </footer>
    </div>
  );
}
