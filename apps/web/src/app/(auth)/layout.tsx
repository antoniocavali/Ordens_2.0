import type { ReactNode } from 'react';
import { AuthShowcase } from '@/features/auth/auth-showcase';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <main className="flex items-center justify-center px-6 py-12 sm:px-10">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
      <AuthShowcase />
    </div>
  );
}
