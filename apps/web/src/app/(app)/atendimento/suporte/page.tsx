'use client';

import { Suspense } from 'react';
import { SupportPanel } from '@/features/support/support-panel';
import { PageLoading } from '@/components/shell/page-loading';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <SupportPanel key="SUPPORT" team="SUPPORT" />
    </Suspense>
  );
}
