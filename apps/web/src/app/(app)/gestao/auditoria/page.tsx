'use client';

import { Suspense } from 'react';
import { AuditPage } from '@/features/audit/audit-page';

export default function Page() {
  return (
    <Suspense>
      <AuditPage />
    </Suspense>
  );
}
