'use client';

import { Suspense } from 'react';
import { AuditPage } from '@/features/audit/audit-page';
import { PageLoading } from '@/components/shell/page-loading';

export default function Page() {
  return (
    <Suspense fallback={<PageLoading />}>
      <AuditPage />
    </Suspense>
  );
}
