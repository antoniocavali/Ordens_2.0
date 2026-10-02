'use client';

import { Suspense } from 'react';
import { LoadsPage } from '@/features/logistics/loads-page';
import { PageLoading } from '@/components/shell/page-loading';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <LoadsPage />
    </Suspense>
  );
}
