'use client';

import { Suspense } from 'react';
import { SupportDashboard } from '@/features/support/support-dashboard';

export default function Page() {
  return (
    <Suspense>
      <SupportDashboard />
    </Suspense>
  );
}
