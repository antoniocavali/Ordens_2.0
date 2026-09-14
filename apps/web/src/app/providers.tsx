'use client';

import { TooltipProvider } from '@ordens/ui';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';
import { ApiRequestError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            retry: (count, err) => !(err instanceof ApiRequestError && err.status > 0 && err.status < 500) && count < 2,
          },
        },
        queryCache: new QueryCache(),
        mutationCache: new MutationCache(),
      }),
  );

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <QueryClientProvider client={client}>
        <MotionConfig reducedMotion="user">
          <TooltipProvider delayDuration={250}>
            {children}
            <Toaster
              position="bottom-right"
              toastOptions={{
                classNames: {
                  toast: '!bg-surface !text-text !ring-1 !ring-border !shadow-lg !rounded-lg !border-0',
                  description: '!text-muted',
                },
              }}
            />
          </TooltipProvider>
        </MotionConfig>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
