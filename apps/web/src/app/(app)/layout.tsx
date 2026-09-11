'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname } from 'next/navigation';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { CommandPalette } from '@/components/shell/command-palette';
import { ChatWidget } from '@/features/support/chat-widget';
import { Header } from '@/components/shell/header';
import { Sidebar } from '@/components/shell/sidebar';
import { Logo } from '@/features/auth/auth-showcase';
import { patch } from '@/lib/api';
import { useSessionGuard } from '@/lib/session';

export default function AppLayout({ children }: { children: ReactNode }) {
  const me = useSessionGuard();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    if (me.data) setCollapsed(me.data.user.sidebarCollapsed);
  }, [me.data]);

  const toggle = () => {
    setCollapsed((c) => {
      patch('/me/preferences', { sidebarCollapsed: !c }).catch(() => undefined);
      return !c;
    });
  };

  if (!me.data || me.data.stage !== 'ACTIVE') {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-4">
          <Logo className="size-10 animate-pulse" />
          <p className="text-sm text-muted">Carregando sua central…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>
      <aside className="hidden h-full shrink-0 lg:block">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
      </aside>

      <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--overlay)] lg:hidden" />
          <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 left-0 z-50 lg:hidden">
            <Dialog.Title className="sr-only">Menu</Dialog.Title>
            <Sidebar collapsed={false} onNavigate={() => setMobileOpen(false)} />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="flex min-w-0 flex-1 flex-col">
        <Header onOpenMobileNav={() => setMobileOpen(true)} onOpenPalette={() => setPaletteOpen(true)} />
        <main id="conteudo" className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
              className="min-h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Suspense>
        <ChatWidget />
      </Suspense>
    </div>
  );
}
