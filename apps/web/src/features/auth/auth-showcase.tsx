import { Eye, Route, ShieldCheck, Truck } from 'lucide-react';

/** Painel visual da tela de login (desktop): identidade TMS com dados ilustrativos. */
export function AuthShowcase() {
  return (
    <aside className="relative hidden overflow-hidden bg-nav lg:block" aria-hidden>
      <div className="absolute inset-0 bg-[radial-gradient(1200px_600px_at_80%_-10%,rgb(139_92_246/0.35),transparent_60%),radial-gradient(800px_500px_at_0%_110%,rgb(79_70_229/0.28),transparent_60%)]" />
      <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgb(255_255_255)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255)_1px,transparent_1px)] [background-size:44px_44px]" />
      <div className="relative flex h-full flex-col justify-between p-12 text-white">
        <div className="flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold tracking-tight">Ordens</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">TMS</span>
        </div>

        <div className="space-y-8">
          <div className="max-w-md space-y-3">
            <h2 className="text-[32px] font-semibold leading-tight tracking-tight">
              Do contrato à carga recebida, <span className="text-violet-300">em tempo real.</span>
            </h2>
            <p className="text-[15px] leading-relaxed text-white/65">
              Ordens, liberações, agendamentos, NF-e e rastreabilidade completa entre Matriz, Fazendas e Compradores.
            </p>
          </div>

          <div className="max-w-md rounded-xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur">
            <div className="flex items-center justify-between text-xs text-white/60">
              <span className="font-mono">OC 2026/00125</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-emerald-300">
                <span className="size-1.5 rounded-full bg-emerald-300" /> Em execução
              </span>
            </div>
            <div className="mt-2 text-lg font-semibold">Milho · 1.000 t</div>
            <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-white/10">
              <div className="w-[30%] bg-violet-400" />
              <div className="w-[12%] bg-indigo-400" />
              <div className="w-[8%] bg-emerald-400" />
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-white/60">
              <span>Liberado 300 t</span>
              <span>Carregado 120 t</span>
              <span>Recebido 80 t</span>
            </div>
          </div>

          <ul className="grid max-w-md grid-cols-2 gap-3 text-[13px] text-white/75">
            {[
              [ShieldCheck, 'Isolamento por tenant e organização'],
              [Eye, 'Faróis de visualização por versão'],
              [Route, 'Liberações parciais e saldo'],
              [Truck, 'Agendamentos e cargas'],
            ].map(([Icon, label]) => {
              const I = Icon as typeof ShieldCheck;
              return (
                <li key={label as string} className="flex items-center gap-2">
                  <I className="size-4 text-violet-300" />
                  {label as string}
                </li>
              );
            })}
          </ul>
        </div>

        <p className="text-xs text-white/40">© {new Date().getFullYear()} Ordens · Plataforma de gestão logística</p>
      </div>
    </aside>
  );
}

export function Logo({ className = 'size-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="none">
      <rect width="32" height="32" rx="9" fill="url(#lg)" />
      <path d="M9 20.5 16 9l7 11.5" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.5 16.5h9" stroke="white" strokeOpacity=".7" strokeWidth="2.4" strokeLinecap="round" />
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#4F46E5" />
        </linearGradient>
      </defs>
    </svg>
  );
}
