'use client';

import { Suspense } from 'react';
import { SupportDashboard } from '@/features/support/support-dashboard';
import { PageLoading } from '@/components/shell/page-loading';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SupportDashboard />
    </Suspense>
  );
}
